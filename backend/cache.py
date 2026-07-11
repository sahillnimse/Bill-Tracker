"""
Lightweight SQLite cache so the dashboard doesn't re-call provider APIs
(AWS Cost Explorer, Google Ads, etc - several of which are rate-limited or
billed per-call) on every single page view. A manual "Sync now" or the
background scheduler refreshes this.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

DB_PATH = Path(__file__).parent / "data" / "spendwatch.db"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS provider_cache (
                provider TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS anomaly_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                date TEXT NOT NULL,
                message TEXT NOT NULL,
                z_score REAL,
                method TEXT DEFAULT 'z_score',
                emailed INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            )
            """
        )
        existing_cols = [r[1] for r in conn.execute("PRAGMA table_info(anomaly_history)").fetchall()]
        if "method" not in existing_cols:
            conn.execute("ALTER TABLE anomaly_history ADD COLUMN method TEXT DEFAULT 'z_score'")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS allowed_users (
                email TEXT PRIMARY KEY,
                name TEXT,
                totp_secret TEXT,
                enrolled INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS revoked_sessions (
                jti TEXT PRIMARY KEY,
                expires_at REAL NOT NULL
            )
            """
        )
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()


def set_provider_cache(provider: str, payload: dict[str, Any], days: int = 30) -> None:
    cache_key = f"{provider}:{days}"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO provider_cache (provider, payload, fetched_at) VALUES (?, ?, ?) "
            "ON CONFLICT(provider) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            (cache_key, json.dumps(payload), time.time()),
        )
        conn.commit()


def get_provider_cache(provider: str, max_age_seconds: Optional[int] = None, days: int = 30) -> Optional[dict[str, Any]]:
    cache_key = f"{provider}:{days}"
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload, fetched_at FROM provider_cache WHERE provider = ?", (cache_key,)
        ).fetchone()
    if not row:
        return None
    payload, fetched_at = row
    if max_age_seconds is not None and (time.time() - fetched_at) > max_age_seconds:
        return None
    data = json.loads(payload)
    data["_fetched_at"] = fetched_at
    return data


def record_anomaly(provider: str, date: str, message: str, z_score: float, method: str = "z_score", emailed: bool = False) -> None:
    """Insert an anomaly, but skip if one was already recorded for this
    exact provider+date+method (prevents duplicate rows from repeated
    polling/cache-refresh cycles hitting the same day's anomaly, while
    still allowing z-score and SMA to each record independently)."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM anomaly_history WHERE provider = ? AND date = ? AND method = ? LIMIT 1",
            (provider, date, method),
        ).fetchone()
        if existing:
            return
        conn.execute(
            "INSERT INTO anomaly_history (provider, date, message, z_score, method, emailed, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (provider, date, message, z_score, method, int(emailed), time.time()),
        )
        conn.commit()


def cleanup_old_anomalies(max_age_hours: float = 48, max_rows: int = 500) -> None:
    """Keep the anomaly_history table from growing unbounded.
    History auto-clears after `max_age_hours` (default 48h)."""
    cutoff = time.time() - (max_age_hours * 3600)
    with get_conn() as conn:
        conn.execute("DELETE FROM anomaly_history WHERE created_at < ?", (cutoff,))
        conn.execute(
            "DELETE FROM anomaly_history WHERE id NOT IN ("
            "SELECT id FROM anomaly_history ORDER BY created_at DESC LIMIT ?)",
            (max_rows,),
        )
        conn.commit()


def get_anomaly_history(provider: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    """Return recent anomalies, deduped so a single spend event doesn't show
    up twice just because both the z-score and SMA detectors flagged the
    same provider on the same day. Both raw rows stay in the DB (they're
    kept for the emailer / audit trail) - this only collapses what's
    *returned* for display, keeping whichever method flagged the larger
    deviation for that provider+date."""
    # Pull extra rows before limiting, since collapsing pairs down to one
    # entry each means a naive `LIMIT` up front could cut a pair in half.
    fetch_limit = max(limit * 2, limit + 20)
    with get_conn() as conn:
        if provider:
            rows = conn.execute(
                "SELECT id, provider, date, message, z_score, method, emailed FROM anomaly_history "
                "WHERE provider = ? ORDER BY created_at DESC LIMIT ?",
                (provider, fetch_limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, provider, date, message, z_score, method, emailed FROM anomaly_history "
                "ORDER BY created_at DESC LIMIT ?",
                (fetch_limit,),
            ).fetchall()

    best_by_key: dict[tuple[str, str], tuple] = {}
    for r in rows:
        _id, prov, date, message, z_score, method, emailed = r
        key = (prov, date)
        current = best_by_key.get(key)
        if current is None or abs(z_score or 0.0) > abs(current[4] or 0.0):
            best_by_key[key] = r

    deduped = sorted(best_by_key.values(), key=lambda r: r[0], reverse=True)[:limit]
    return [
        {"id": r[0], "provider": r[1], "date": r[2], "message": r[3], "z_score": r[4], "method": r[5] or "z_score", "emailed": bool(r[6])}
        for r in deduped
    ]


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        conn.commit()


def revoke_session(jti: str, expires_at: float) -> None:
    """Marks a session's JWT ID as revoked until its natural expiry."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO revoked_sessions (jti, expires_at) VALUES (?, ?) "
            "ON CONFLICT(jti) DO NOTHING",
            (jti, expires_at),
        )
        conn.commit()


def is_session_revoked(jti: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT 1 FROM revoked_sessions WHERE jti = ?", (jti,)).fetchone()
    return row is not None


def cleanup_expired_revocations() -> None:
    """Drops revoked-session entries whose JWT would have expired anyway — keeps the table small."""
    with get_conn() as conn:
        conn.execute("DELETE FROM revoked_sessions WHERE expires_at < ?", (time.time(),))
        conn.commit()
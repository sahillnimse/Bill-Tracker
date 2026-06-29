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
                emailed INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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


def set_provider_cache(provider: str, payload: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO provider_cache (provider, payload, fetched_at) VALUES (?, ?, ?) "
            "ON CONFLICT(provider) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            (provider, json.dumps(payload), time.time()),
        )
        conn.commit()


def get_provider_cache(provider: str, max_age_seconds: Optional[int] = None) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload, fetched_at FROM provider_cache WHERE provider = ?", (provider,)
        ).fetchone()
    if not row:
        return None
    payload, fetched_at = row
    if max_age_seconds is not None and (time.time() - fetched_at) > max_age_seconds:
        return None
    data = json.loads(payload)
    data["_fetched_at"] = fetched_at
    return data


def record_anomaly(provider: str, date: str, message: str, z_score: float, emailed: bool = False) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO anomaly_history (provider, date, message, z_score, emailed, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (provider, date, message, z_score, int(emailed), time.time()),
        )
        conn.commit()


def get_anomaly_history(provider: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if provider:
            rows = conn.execute(
                "SELECT provider, date, message, z_score, emailed FROM anomaly_history "
                "WHERE provider = ? ORDER BY created_at DESC LIMIT ?",
                (provider, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT provider, date, message, z_score, emailed FROM anomaly_history "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [
        {"provider": r[0], "date": r[1], "message": r[2], "z_score": r[3], "emailed": bool(r[4])}
        for r in rows
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

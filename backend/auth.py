"""
TOTP-based login — restricts SpendWatch access to a manually maintained
allowlist of emails, authenticated via a standard authenticator app (Microsoft
Authenticator, Google Authenticator, Authy, etc.) instead of Microsoft OAuth.

Flow:
  1. Admin adds an email to the `allowed_users` table (see add_user.py).
  2. That person opens the login page, enters their email.
  3. If not yet enrolled, backend generates a TOTP secret + QR code. They scan
     it into their authenticator app and confirm with the first 6-digit code.
  4. From then on, login = email + current 6-digit code from their app.

This is a SEPARATE, simpler flow from the app-only Graph API access used in
providers/microsoft365.py, which is unrelated and untouched by this file.
"""
from __future__ import annotations

import base64
import io
import time
import uuid
from typing import Any

import pyotp
import qrcode
from fastapi import Cookie, HTTPException, Request
import jwt

from cache import get_conn, is_session_revoked, revoke_session
from config import auth_config

SESSION_COOKIE_NAME = "spendwatch_session"


def _get_user_row(email: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT email, name, totp_secret, enrolled FROM allowed_users WHERE email = ?",
            (email.lower().strip(),),
        ).fetchone()
    if not row:
        return None
    return {"email": row[0], "name": row[1], "totp_secret": row[2], "enrolled": bool(row[3])}


def start_enrollment(email: str) -> dict[str, Any]:
    """
    Called when someone types their email on the login page.
    Returns either {"enrolled": True} (they should enter a code) or
    {"enrolled": False, "qr_code_data_url": "..."} (first-time setup).
    """
    email = email.lower().strip()
    user = _get_user_row(email)
    if not user:
        raise HTTPException(status_code=403, detail="This email is not authorized for SpendWatch access.")

    if user["enrolled"] and user["totp_secret"]:
        return {"enrolled": True}

    secret = user["totp_secret"] or pyotp.random_base32()
    with get_conn() as conn:
        conn.execute(
            "UPDATE allowed_users SET totp_secret = ? WHERE email = ?",
            (secret, email),
        )
        conn.commit()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=email, issuer_name=auth_config.totp_issuer)

    qr_img = qrcode.make(provisioning_uri)
    buf = io.BytesIO()
    qr_img.save(buf)
    qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {
        "enrolled": False,
        "qr_code_data_url": f"data:image/png;base64,{qr_b64}",
    }


def confirm_enrollment(email: str, code: str) -> str:
    """Verifies the first code from a freshly scanned QR, marks user enrolled, returns session token."""
    email = email.lower().strip()
    user = _get_user_row(email)
    if not user or not user["totp_secret"]:
        raise HTTPException(status_code=400, detail="No enrollment in progress for this email.")

    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Incorrect code. Please try again.")

    with get_conn() as conn:
        conn.execute("UPDATE allowed_users SET enrolled = 1 WHERE email = ?", (email,))
        conn.commit()

    return _issue_session(email, user["name"])


def verify_login(email: str, code: str) -> str:
    """Normal login — email + current 6-digit code from an already-enrolled authenticator app."""
    email = email.lower().strip()
    user = _get_user_row(email)
    if not user or not user["enrolled"] or not user["totp_secret"]:
        raise HTTPException(status_code=403, detail="This email is not enrolled. Please enroll first.")

    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Incorrect code. Please try again.")

    return _issue_session(email, user["name"])


def _issue_session(email: str, name: str | None) -> str:
    now = int(time.time())
    session_payload = {
        "email": email,
        "name": name or email,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + auth_config.session_ttl_hours * 3600,
    }
    return jwt.encode(session_payload, auth_config.session_secret, algorithm="HS256")


def get_current_user(session: dict) -> dict[str, Any]:
    return {"email": session.get("email"), "name": session.get("name")}


async def require_session(
    request: Request,
    spendwatch_session: str | None = Cookie(default=None),
) -> dict[str, Any]:
    """FastAPI dependency — attach to any route that needs a logged-in, allowlisted user."""
    if not spendwatch_session:
        raise HTTPException(status_code=401, detail="Not signed in.")
    try:
        payload = jwt.decode(spendwatch_session, auth_config.session_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session.")

    jti = payload.get("jti")
    if jti and is_session_revoked(jti):
        raise HTTPException(status_code=401, detail="Session has been signed out. Please sign in again.")

    return payload


def revoke_current_session(session: dict) -> None:
    """Called on logout — blocks this specific session's JWT from being reused even before it expires."""
    jti = session.get("jti")
    exp = session.get("exp")
    if jti and exp:
        revoke_session(jti, float(exp))
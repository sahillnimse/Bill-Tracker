"""
Login with Microsoft — restricts SpendWatch access to Xarka's own Microsoft
365 tenant.

This is a SEPARATE OAuth flow from the app-only Graph API access used in
providers/microsoft365.py. That flow lets the backend read organization-wide
data with no user present. This flow is the interactive "a human signs in"
flow (Authorization Code), used only to answer one question: is the person
opening this dashboard actually a member of Xarka's Microsoft 365 tenant?
"""
from __future__ import annotations

import base64
import logging
import time
import uuid
from typing import Any

import httpx
import jwt
from fastapi import Cookie, HTTPException, Request

from config import auth_config

logger = logging.getLogger("spendwatch.auth")

AUTHORITY = f"https://login.microsoftonline.com/{auth_config.tenant_id}"
AUTH_ENDPOINT = f"{AUTHORITY}/oauth2/v2.0/authorize"
TOKEN_ENDPOINT = f"{AUTHORITY}/oauth2/v2.0/token"
SCOPES = "openid profile email User.Read"

SESSION_COOKIE_NAME = "spendwatch_session"

_pending_states: dict[str, float] = {}
_STATE_TTL_SECONDS = 600  # 10 minutes to complete login

# Profile photos keyed by email — kept out of the session JWT since base64
# photos are too large for a cookie. Lost on backend restart; user just
# re-logs in to refresh it.
_photo_cache: dict[str, str | None] = {}


def _cleanup_states() -> None:
    now = time.time()
    expired = [s for s, ts in _pending_states.items() if now - ts > _STATE_TTL_SECONDS]
    for s in expired:
        _pending_states.pop(s, None)


def build_authorize_url() -> str:
    if not (auth_config.tenant_id and auth_config.client_id):
        raise RuntimeError("AUTH_TENANT_ID / AUTH_CLIENT_ID (or MS365_* equivalents) missing in .env")

    _cleanup_states()
    state = uuid.uuid4().hex
    _pending_states[state] = time.time()

    params = {
        "client_id": auth_config.client_id,
        "response_type": "code",
        "redirect_uri": auth_config.redirect_uri,
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
    }
    query = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    return f"{AUTH_ENDPOINT}?{query}"


def validate_state(state: str | None) -> None:
    _cleanup_states()
    if not state or state not in _pending_states:
        raise HTTPException(status_code=400, detail="Invalid or expired login attempt. Please try signing in again.")
    _pending_states.pop(state, None)


def _exchange_code_for_claims(code: str) -> dict[str, Any]:
    """Exchanges the OAuth code for tokens and returns the decoded ID token claims."""
    resp = httpx.post(
        TOKEN_ENDPOINT,
        data={
            "client_id": auth_config.client_id,
            "client_secret": auth_config.client_secret,
            "code": code,
            "redirect_uri": auth_config.redirect_uri,
            "grant_type": "authorization_code",
            "scope": SCOPES,
        },
        timeout=15,
    )
    if resp.status_code != 200:
        logger.warning("Token exchange failed: %s", resp.text[:500])
        raise HTTPException(status_code=401, detail="Microsoft sign-in failed. Please try again.")

    tokens = resp.json()
    id_token = tokens.get("id_token")
    access_token = tokens.get("access_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Microsoft did not return an ID token.")

    claims = jwt.decode(id_token, options={"verify_signature": False})
    claims["_access_token"] = access_token
    return claims


def _fetch_profile(access_token: str | None) -> dict[str, Any]:
    """Best-effort fetch of richer profile fields (title, department, photo) via Graph /me."""
    profile: dict[str, Any] = {
        "job_title": None,
        "department": None,
        "office_location": None,
        "mobile_phone": None,
        "employee_id": None,
        "manager_name": None,
        "photo_data_url": None,
    }
    if not access_token:
        return profile

    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me",
            headers=headers,
            params={
                "$select": "jobTitle,department,mail,userPrincipalName,displayName,"
                           "officeLocation,mobilePhone,employeeId"
            },
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            profile["job_title"] = data.get("jobTitle")
            profile["department"] = data.get("department")
            profile["office_location"] = data.get("officeLocation")
            profile["mobile_phone"] = data.get("mobilePhone")
            profile["employee_id"] = data.get("employeeId")
    except Exception as exc:
        logger.warning("Graph /me profile fetch failed: %s", exc)

    # Manager is a separate Graph relationship, not a /me field.
    try:
        mgr_resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me/manager",
            headers=headers,
            params={"$select": "displayName"},
            timeout=10,
        )
        if mgr_resp.status_code == 200:
            profile["manager_name"] = mgr_resp.json().get("displayName")
    except Exception as exc:
        logger.info("No manager info available: %s", exc)

    try:
        photo_resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me/photo/$value",
            headers=headers,
            timeout=10,
        )
        if photo_resp.status_code == 200:
            b64 = base64.b64encode(photo_resp.content).decode("ascii")
            content_type = photo_resp.headers.get("content-type", "image/jpeg")
            profile["photo_data_url"] = f"data:{content_type};base64,{b64}"
    except Exception as exc:
        logger.info("No profile photo available: %s", exc)

    return profile


def verify_tenant_and_issue_session(code: str) -> str:
    """
    Exchanges the code, checks the token's tenant matches ours, and returns
    a signed session cookie value. Raises HTTPException if the signed-in
    account is outside Xarka's tenant.
    """
    claims = _exchange_code_for_claims(code)

    token_tenant = claims.get("tid")
    if token_tenant != auth_config.tenant_id:
        logger.warning("Rejected sign-in from foreign tenant: %s", token_tenant)
        raise HTTPException(
            status_code=403,
            detail="This account is not part of Xarka's Microsoft 365 organization.",
        )

    email = claims.get("preferred_username") or claims.get("email") or "unknown"
    name = claims.get("name") or email
    profile = _fetch_profile(claims.get("_access_token"))

    # ---- Allowlist hook (add later) ----
    # from providers.microsoft365 import fetch_ms365_data
    # known_emails = {u["email"] for u in fetch_ms365_data().get("recent_users", [])}
    # if email.lower() not in known_emails:
    #     raise HTTPException(status_code=403, detail="Not a recognized Xarka employee.")
    # -------------------------------------

    _photo_cache[email] = profile.get("photo_data_url")

    now = int(time.time())
    session_payload = {
        "email": email,
        "name": name,
        "tid": token_tenant,
        "job_title": profile.get("job_title"),
        "department": profile.get("department"),
        "office_location": profile.get("office_location"),
        "mobile_phone": profile.get("mobile_phone"),
        "employee_id": profile.get("employee_id"),
        "manager_name": profile.get("manager_name"),
        "iat": now,
        "exp": now + auth_config.session_ttl_hours * 3600,
    }
    return jwt.encode(session_payload, auth_config.session_secret, algorithm="HS256")


def get_current_user(session: dict) -> dict[str, Any]:
    email = session.get("email")
    return {
        "email": email,
        "name": session.get("name"),
        "job_title": session.get("job_title"),
        "department": session.get("department"),
        "office_location": session.get("office_location"),
        "mobile_phone": session.get("mobile_phone"),
        "employee_id": session.get("employee_id"),
        "manager_name": session.get("manager_name"),
        "photo_data_url": _photo_cache.get(email),
    }


async def require_session(
    request: Request,
    spendwatch_session: str | None = Cookie(default=None),
) -> dict[str, Any]:
    """FastAPI dependency — attach to any route that needs a logged-in Xarka user."""
    if not spendwatch_session:
        raise HTTPException(status_code=401, detail="Not signed in.")
    try:
        payload = jwt.decode(spendwatch_session, auth_config.session_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session.")

    if payload.get("tid") != auth_config.tenant_id:
        raise HTTPException(status_code=403, detail="Session tenant mismatch.")

    return payload
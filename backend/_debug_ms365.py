"""
MS365 diagnostic script — tests token, endpoints, and decodes claims.
Run from backend/ with: python _debug_ms365.py
"""
import base64
import json
import sys

import httpx
import msal

from config import ms365_config

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_BETA = "https://graph.microsoft.com/beta"


def decode_jwt(token: str) -> dict:
    """Decode JWT payload (without verification)."""
    parts = token.split(".")
    if len(parts) != 3:
        return {"error": "not a valid JWT"}
    payload = parts[1]
    padded = payload + "=" * (4 - len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception as e:
        return {"error": str(e)}


def get_token():
    app = msal.ConfidentialClientApplication(
        ms365_config.client_id,
        authority=f"https://login.microsoftonline.com/{ms365_config.tenant_id}",
        client_credential=ms365_config.client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        raise RuntimeError(f"Auth failed: {result.get('error_description')}")
    return result["access_token"]


def graph_get(token, base, path, params=None, extra_headers=None):
    headers = {"Authorization": f"Bearer {token}"}
    if extra_headers:
        headers.update(extra_headers)
    resp = httpx.get(f"{base}{path}", headers=headers, params=params or {}, timeout=30)
    return resp


def main():
    print("=" * 60)
    print("MS365 DIAGNOSTIC")
    print("=" * 60)

    # 1. Get a token
    print("\n--- 1. Token Acquisition ---")
    try:
        token = get_token()
        print("[OK] Token acquired successfully")
    except Exception as e:
        print(f"[FAIL] {e}")
        sys.exit(1)

    # 2. Decode token
    print("\n--- 2. Token Claims ---")
    claims = decode_jwt(token)
    print(f"  appId (client_id in token):  {claims.get('appid', 'N/A')}")
    print(f"  Expected client_id:           {ms365_config.client_id}")
    print(f"  tid (tenant):                 {claims.get('tid', 'N/A')}")
    print(f"  Expected tenant:              {ms365_config.tenant_id}")
    print(f"  iss (issuer):                 {claims.get('iss', 'N/A')}")
    print(f"  iat (issued at):              {claims.get('iat', 'N/A')}")
    print(f"  exp (expires):                {claims.get('exp', 'N/A')}")
    roles = claims.get("roles", [])
    scp = claims.get("scp", None)
    print(f"  roles (app permissions):      {roles}")
    print(f"  scp (delegated perms):        {scp or '(none — good for app-only)'}")

    # Check if AuditLog.Read.All is present
    has_audit_log = "AuditLog.Read.All" in roles
    has_reports_read = "Reports.Read.All" in roles
    has_directory_read = "Directory.Read.All" in roles
    has_user_read = "User.Read.All" in roles
    has_org_read = "Organization.Read.All" in roles

    print(f"\n  AuditLog.Read.All:    {'PRESENT' if has_audit_log else 'MISSING'}")
    print(f"  Reports.Read.All:     {'PRESENT' if has_reports_read else 'MISSING'}")
    print(f"  Directory.Read.All:   {'PRESENT' if has_directory_read else 'MISSING'}")
    print(f"  User.Read.All:        {'PRESENT' if has_user_read else 'MISSING'}")
    print(f"  Organization.Read.All: {'PRESENT' if has_org_read else 'MISSING'}")

    # 3. Test signInActivity on /users (v1.0)
    print("\n--- 3a. /users with $select=signInActivity (v1.0) ---")
    resp = graph_get(
        token, GRAPH_BASE, "/users",
        params={"$select": "id,signInActivity", "$top": "1", "$count": "true"},
        extra_headers={"ConsistencyLevel": "eventual"},
    )
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        user = (data.get("value") or [None])[0]
        if user:
            sia = user.get("signInActivity")
            print(f"  signInActivity present: {sia is not None}")
            if sia:
                print(f"  lastSuccessfulSignIn: {sia.get('lastSuccessfulSignInDateTime')}")
            else:
                print(f"  User object keys: {list(user.keys())}")
                print("  signInActivity property missing — likely Azure AD Premium license issue")
        else:
            print("  No users returned")
    elif resp.status_code == 403:
        # Try to parse the error body
        try:
            err_body = resp.json()
            print(f"  Error: {err_body.get('error', {}).get('message', resp.text[:200])}")
        except Exception:
            print(f"  403 Forbidden: {resp.text[:200]}")
    else:
        print(f"  Response: {resp.text[:300]}")

    # 3b. Test /users signInActivity via beta
    print("\n--- 3b. /users with $select=signInActivity (beta) ---")
    resp = graph_get(
        token, GRAPH_BETA, "/users",
        params={"$select": "id,signInActivity", "$top": "1", "$count": "true"},
        extra_headers={"ConsistencyLevel": "eventual"},
    )
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        user = (data.get("value") or [None])[0]
        if user:
            sia = user.get("signInActivity")
            print(f"  signInActivity present: {sia is not None}")
            if sia:
                print(f"  lastSuccessfulSignIn: {sia.get('lastSuccessfulSignInDateTime')}")
    elif resp.status_code == 403:
        try:
            err_body = resp.json()
            print(f"  Error: {err_body.get('error', {}).get('message', resp.text[:200])}")
        except Exception:
            print(f"  403 Forbidden: {resp.text[:200]}")

    # 4a. MFA report — v1.0 /reports/credentialUserRegistrationDetails
    print("\n--- 4a. /reports/credentialUserRegistrationDetails (v1.0) ---")
    resp = graph_get(token, GRAPH_BASE, "/reports/credentialUserRegistrationDetails")
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"  Value count: {len(data.get('value', []))}")
    else:
        try:
            err_body = resp.json()
            print(f"  Error: {err_body.get('error', {}).get('message', resp.text[:200])}")
        except Exception:
            print(f"  Response: {resp.text[:200]}")

    # 4b. MFA report — beta
    print("\n--- 4b. /reports/credentialUserRegistrationDetails (beta) ---")
    resp = graph_get(token, GRAPH_BETA, "/reports/credentialUserRegistrationDetails")
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"  Value count: {len(data.get('value', []))}")
    else:
        try:
            err_body = resp.json()
            print(f"  Error: {err_body.get('error', {}).get('message', resp.text[:200])}")
        except Exception:
            print(f"  Response: {resp.text[:200]}")

    # 5. Additional: check if /users without signInActivity works (baseline validation)
    print("\n--- 5. Baseline: /users without signInActivity (v1.0) ---")
    resp = graph_get(
        token, GRAPH_BASE, "/users",
        params={"$select": "id,displayName", "$top": "1"},
    )
    print(f"  Status: {resp.status_code}")
    print(f"  Can read basic user data: {resp.status_code == 200}")

    # 6. Test subscribedSkus
    print("\n--- 6. /subscribedSkus (v1.0) ---")
    resp = graph_get(token, GRAPH_BASE, "/subscribedSkus")
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"  SKUs found: {len(data.get('value', []))}")
        for sku in data.get("value", []):
            print(f"    - {sku.get('skuPartNumber')}: {sku.get('consumedUnits')} seats")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()

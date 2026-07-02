"""
generate_refresh_token.py

Standalone helper to generate a new Google Ads OAuth2 refresh token.
Run this from your backend folder with venv activated:

    python generate_refresh_token.py

It will:
  1. Open your browser to log in with your Google Ads account and approve access
  2. Print a brand new refresh token to paste into your .env as GOOGLE_ADS_REFRESH_TOKEN

You need your Client ID and Client Secret from Google Cloud Console
(the same ones already in your .env as GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET).
This script will prompt you for them interactively so they are never
pasted into chat or committed to a file.
"""
from __future__ import annotations

import getpass

from google_auth_oauthlib.flow import InstalledAppFlow

# Google Ads API requires this specific OAuth scope
SCOPES = ["https://www.googleapis.com/auth/adwords"]


def main() -> None:
    print("=== Google Ads Refresh Token Generator ===")
    client_id = getpass.getpass("Paste your GOOGLE_ADS_CLIENT_ID (input hidden): ").strip()
    client_secret = getpass.getpass("Paste your GOOGLE_ADS_CLIENT_SECRET (input hidden): ").strip()

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    print("\nA browser window will open. Log in with the Google account that")
    print("has access to your Google Ads account, and click Allow.\n")

    credentials = flow.run_local_server(port=0)

    print("\n=== SUCCESS ===")
    print("Copy the line below into your .env file, replacing the old")
    print("GOOGLE_ADS_REFRESH_TOKEN value:\n")
    print(f"GOOGLE_ADS_REFRESH_TOKEN={credentials.refresh_token}")
    print("\nDo not share this value or paste it anywhere public.")


if __name__ == "__main__":
    main()
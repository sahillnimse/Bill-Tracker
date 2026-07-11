"""
One-off CLI to add someone to the SpendWatch access allowlist.

Usage:
    python add_user.py sahil.nimse@xarka.in "Sahil Nimse"

After running this, that person can open the login page, enter their email,
and will be walked through scanning a QR code into Microsoft Authenticator
(or any TOTP app) to finish enrollment.
"""
import sys
import time

from cache import get_conn, init_db


def add_user(email: str, name: str) -> None:
    email = email.lower().strip()
    init_db()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT email FROM allowed_users WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            print(f"'{email}' is already on the allowlist.")
            return
        conn.execute(
            "INSERT INTO allowed_users (email, name, totp_secret, enrolled, created_at) "
            "VALUES (?, ?, NULL, 0, ?)",
            (email, name, time.time()),
        )
        conn.commit()
    print(f"Added '{email}' ({name}) to the allowlist. They can now enroll at the login page.")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print('Usage: python add_user.py <email> "<name>"')
        sys.exit(1)
    add_user(sys.argv[1], sys.argv[2])
"""
Email alerting via Gmail SMTP — same pattern as the internal cloud cost
tracker tool. Requires a Gmail App Password (16-char), not your normal
account password (Google Account > Security > App passwords).
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import smtp_config

logger = logging.getLogger("spendwatch.alerts")


def send_anomaly_email(provider: str, subject: str, body: str) -> bool:
    if not smtp_config.sender_email or not smtp_config.app_password:
        logger.warning("SMTP not configured — skipping email alert for %s", provider)
        return False

    recipients = [r.strip() for r in smtp_config.recipients.split(",") if r.strip()]
    if not recipients:
        logger.warning("No ALERT_RECIPIENTS configured — skipping email alert")
        return False

    msg = MIMEMultipart()
    msg["From"] = smtp_config.sender_email
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = f"[SpendWatch] {subject}"
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(smtp_config.sender_email, smtp_config.app_password)
            server.sendmail(smtp_config.sender_email, recipients, msg.as_string())
        logger.info("Anomaly alert email sent for %s", provider)
        return True
    except Exception:
        logger.exception("Failed to send anomaly alert email for %s", provider)
        return False

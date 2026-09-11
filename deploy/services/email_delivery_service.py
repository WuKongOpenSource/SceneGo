"""Verified-email queuing and SMTP outbox delivery."""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any, Optional

from dao.email_outbox import EmailOutboxDAO


logger = logging.getLogger(__name__)


def smtp_enabled() -> bool:
    enabled = (os.getenv("OSTORY_SMTP_ENABLED") or "false").strip().lower() in {"1", "true", "yes", "on"}
    return enabled and bool((os.getenv("OSTORY_SMTP_HOST") or "").strip()) and bool(
        (os.getenv("OSTORY_EMAIL_FROM_ADDRESS") or "").strip()
    )


def _smtp_config() -> dict[str, Any]:
    return {
        "host": (os.getenv("OSTORY_SMTP_HOST") or "").strip(),
        "port": int(os.getenv("OSTORY_SMTP_PORT") or "587"),
        "username": (os.getenv("OSTORY_SMTP_USERNAME") or "").strip(),
        "password": (os.getenv("OSTORY_SMTP_PASSWORD") or "").strip(),
        "starttls": (os.getenv("OSTORY_SMTP_STARTTLS") or "true").strip().lower() in {"1", "true", "yes", "on"},
        "from_address": (os.getenv("OSTORY_EMAIL_FROM_ADDRESS") or "").strip(),
        "from_name": (os.getenv("OSTORY_EMAIL_FROM_NAME") or "创剧").strip(),
    }


def _send_message_sync(row: dict[str, Any]) -> None:
    config = _smtp_config()
    if not smtp_enabled() or not config["host"] or not config["from_address"]:
        raise RuntimeError("SMTP delivery is not configured")
    message = EmailMessage()
    message["Subject"] = row["subject"]
    message["From"] = f'{config["from_name"]} <{config["from_address"]}>'
    message["To"] = row["recipient"]
    message.set_content(row["body_text"])
    if row.get("body_html"):
        message.add_alternative(row["body_html"], subtype="html")

    with smtplib.SMTP(config["host"], config["port"], timeout=15) as smtp:
        if config["starttls"]:
            smtp.starttls()
        if config["username"]:
            smtp.login(config["username"], config["password"])
        smtp.send_message(message)


async def enqueue_verification_email(target: str, code: str, purpose: str) -> str:
    subject = "创剧邮箱验证码"
    text = f"你的创剧邮箱验证码是 {code}，5 分钟内有效。请勿将验证码告诉他人。"
    escaped = html.escape(code)
    queued = await EmailOutboxDAO.enqueue(
        recipient=target,
        message_type="email_verification",
        subject=subject,
        body_text=text,
        body_html=(
            "<p>你的创剧邮箱验证码是：</p>"
            f"<p style='font-size:28px;font-weight:700;letter-spacing:6px'>{escaped}</p>"
            "<p>验证码 5 分钟内有效，请勿将验证码告诉他人。</p>"
        ),
        dedupe_key=None,
        metadata={"purpose": purpose},
    )
    if not queued:
        raise RuntimeError("email verification could not be queued")
    return queued["message_id"]


def _preference_key(notification_type: str, title: str, category: Optional[str]) -> Optional[str]:
    if category in {"credit", "credits"}:
        return "credit_alert"
    if category in {"sharing", "share", "collaboration"}:
        return "sharing"
    if notification_type == "task":
        return "task_failure" if "失败" in title else "task_success"
    return None


async def enqueue_notification_email(
    *,
    user_id: str,
    title: str,
    message: str,
    notification_type: str,
    category: Optional[str],
    notification_id: str,
    user_dao: Any,
) -> None:
    preference_key = _preference_key(notification_type, title, category)
    if not preference_key:
        return
    user = await user_dao.get_user_auth_by_id(user_id)
    if not user or not user.get("email") or not user.get("email_verified"):
        return
    preferences = user.get("email_notification_preferences") or {}
    if isinstance(preferences, str):
        try:
            preferences = json.loads(preferences)
        except json.JSONDecodeError:
            preferences = {}
    if preferences.get(preference_key, True) is False:
        return
    await EmailOutboxDAO.enqueue(
        recipient=user["email"],
        user_id=user_id,
        message_type=preference_key,
        subject=f"创剧：{title}",
        body_text=message or title,
        body_html=f"<h2>{html.escape(title)}</h2><p>{html.escape(message or title)}</p>",
        dedupe_key=f"notification:{notification_id}",
        metadata={"notification_id": notification_id},
    )


async def email_outbox_worker_loop(poll_seconds: int = 10) -> None:
    while True:
        if not smtp_enabled():
            await asyncio.sleep(max(10, poll_seconds))
            continue
        row = await EmailOutboxDAO.claim_next()
        if not row:
            await asyncio.sleep(poll_seconds)
            continue
        try:
            await asyncio.to_thread(_send_message_sync, row)
            await EmailOutboxDAO.mark_sent(row["message_id"])
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Email delivery failed message_id=%s: %s", row["message_id"], exc)
            await EmailOutboxDAO.mark_failed(row["message_id"], str(exc), int(row.get("attempts") or 1))

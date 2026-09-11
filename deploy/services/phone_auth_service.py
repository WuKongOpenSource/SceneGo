"""Phone-first account registration, login, binding, and verified email rules."""
from __future__ import annotations

import json
import re
import secrets
from typing import Any, Optional

from services.password_service import hash_password, validate_password_input, verify_password_hash


PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EMAIL_PREFERENCE_KEYS = {"task_success", "task_failure", "credit_alert", "sharing"}


class PhoneAuthError(RuntimeError):
    pass


class InvalidPhone(PhoneAuthError):
    pass


class InvalidEmail(PhoneAuthError):
    pass


class InvalidCredentials(PhoneAuthError):
    pass


class AccountExists(PhoneAuthError):
    pass


class AccountDisabled(PhoneAuthError):
    pass


class AccountNotFound(PhoneAuthError):
    pass


def normalize_phone(value: str) -> str:
    phone = re.sub(r"[\s-]", "", (value or "").strip())
    for prefix in ("+86", "0086", "86"):
        if phone.startswith(prefix) and len(phone) > 11:
            phone = phone[len(prefix):]
            break
    if not PHONE_RE.fullmatch(phone):
        raise InvalidPhone("phone number is invalid")
    return phone


def normalize_email(value: Optional[str]) -> Optional[str]:
    email = (value or "").strip().lower()
    if not email:
        return None
    if len(email) > 255 or not EMAIL_RE.fullmatch(email):
        raise InvalidEmail("email is invalid")
    return email


def validate_password(password: str) -> None:
    try:
        validate_password_input(password)
    except ValueError as exc:
        raise InvalidCredentials("password must be 8-128 characters") from exc


def _assert_active(user: dict[str, Any]) -> None:
    if user.get("status") and user.get("status") != "active":
        raise AccountDisabled(user.get("disabled_reason") or "account disabled")


async def _generated_username(phone: str, user_dao: Any) -> str:
    for _ in range(10):
        candidate = f"创作者{phone[-4:]}{secrets.randbelow(1000):03d}"
        if not await user_dao.get_user_by_username_any(candidate):
            return candidate
    return f"创作者{secrets.token_hex(5)}"


async def register_phone_account(
    *,
    phone: str,
    password: str,
    email: Optional[str],
    code: str,
    verification_manager: Any,
    user_dao: Any,
) -> dict[str, Any]:
    normalized_phone = normalize_phone(phone)
    normalized_email = normalize_email(email)
    validate_password(password)
    if await user_dao.get_user_by_phone(normalized_phone):
        raise AccountExists("phone number is already registered")
    await verification_manager.verify(
        channel="sms", target=normalized_phone, purpose="register", code=code
    )
    username = await _generated_username(normalized_phone, user_dao)
    try:
        user = await user_dao.create_phone_user(
            phone_number=normalized_phone,
            username=username,
            password=password,
            email=normalized_email,
        )
    except Exception as exc:
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise AccountExists("phone number is already registered") from exc
        raise
    if not user:
        raise PhoneAuthError("account could not be created")
    return user


async def login_phone_password(*, phone: str, password: str, user_dao: Any) -> dict[str, Any]:
    normalized_phone = normalize_phone(phone)
    user = await user_dao.get_user_by_phone(normalized_phone)
    if not user:
        raise InvalidCredentials("phone or password is incorrect")
    _assert_active(user)
    valid, needs_upgrade = verify_password_hash(password, user.get("password_hash") or "")
    if not valid:
        raise InvalidCredentials("phone or password is incorrect")
    if needs_upgrade:
        await user_dao.update_password_hash(user["user_id"], hash_password(password))
    await user_dao.update_last_login(user["user_id"])
    return user


async def login_phone_code(
    *,
    phone: str,
    code: str,
    verification_manager: Any,
    user_dao: Any,
) -> dict[str, Any]:
    normalized_phone = normalize_phone(phone)
    user = await user_dao.get_user_by_phone(normalized_phone)
    if not user:
        raise InvalidCredentials("phone or verification code is incorrect")
    _assert_active(user)
    await verification_manager.verify(
        channel="sms", target=normalized_phone, purpose="login", code=code
    )
    await user_dao.update_last_login(user["user_id"])
    return user


async def bind_legacy_phone(
    *,
    user_id: str,
    phone: str,
    code: str,
    verification_manager: Any,
    user_dao: Any,
) -> dict[str, Any]:
    normalized_phone = normalize_phone(phone)
    owner = await user_dao.get_user_by_phone(normalized_phone)
    if owner and owner.get("user_id") != user_id:
        raise AccountExists("phone number is already registered")
    await verification_manager.verify(
        channel="sms", target=normalized_phone, purpose="bind_phone", code=code
    )
    try:
        user = await user_dao.bind_verified_phone(user_id, normalized_phone)
    except Exception as exc:
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise AccountExists("phone number is already registered") from exc
        raise
    if not user:
        raise AccountNotFound("legacy account was not found")
    return user


async def reset_phone_password(
    *,
    phone: str,
    code: str,
    new_password: str,
    verification_manager: Any,
    user_dao: Any,
) -> dict[str, Any]:
    normalized_phone = normalize_phone(phone)
    validate_password(new_password)
    user = await user_dao.get_user_by_phone(normalized_phone)
    if not user:
        raise AccountNotFound("account was not found")
    await verification_manager.verify(
        channel="sms", target=normalized_phone, purpose="password_reset", code=code
    )
    await user_dao.reset_password(user["user_id"], new_password)
    return user


async def begin_email_binding(*, user_id: str, email: str, user_dao: Any) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not normalized:
        raise InvalidEmail("email is required")
    owner = await user_dao.get_user_by_verified_email(normalized)
    if owner and owner.get("user_id") != user_id:
        raise AccountExists("email is already verified by another account")
    user = await user_dao.get_user_auth_by_id(user_id)
    if not user:
        raise AccountNotFound("account was not found")
    # Do not replace a verified address before delivery succeeds. The one-time
    # code is scoped to the normalized target address and this authenticated flow.
    return {"user_id": user_id, "email": normalized}


async def verify_email_binding(
    *,
    user_id: str,
    email: str,
    code: str,
    verification_manager: Any,
    user_dao: Any,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    user = await user_dao.get_user_auth_by_id(user_id)
    if not normalized or not user:
        raise InvalidEmail("email binding is invalid")
    owner = await user_dao.get_user_by_verified_email(normalized)
    if owner and owner.get("user_id") != user_id:
        raise AccountExists("email is already verified by another account")
    await verification_manager.verify(
        channel="email", target=normalized, purpose="email_verify", code=code
    )
    try:
        row = await user_dao.set_email_binding(user_id, normalized, verified=True)
    except Exception as exc:
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise AccountExists("email is already verified by another account") from exc
        raise
    if not row:
        raise AccountNotFound("account was not found")
    return row


def merge_email_preferences(current: Any, updates: dict[str, bool]) -> dict[str, bool]:
    if isinstance(current, str):
        try:
            current = json.loads(current)
        except json.JSONDecodeError:
            current = {}
    merged = {key: bool((current or {}).get(key, True)) for key in EMAIL_PREFERENCE_KEYS}
    for key, value in updates.items():
        if key not in EMAIL_PREFERENCE_KEYS:
            raise PhoneAuthError(f"unsupported email preference: {key}")
        merged[key] = bool(value)
    return merged

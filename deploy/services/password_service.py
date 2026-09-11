"""Password hashing with transparent migration from legacy hash formats."""
from __future__ import annotations

import base64
import hashlib
import hmac

import bcrypt


BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")
PASSWORD_HASH_PREFIX = "$bcrypt-sha256$v=1$"
MIN_PASSWORD_CHARACTERS = 8
MAX_PASSWORD_CHARACTERS = 128


def validate_password_input(password: str) -> None:
    """Validate the shared account-password contract before hashing."""
    if not password or len(password) < MIN_PASSWORD_CHARACTERS:
        raise ValueError(f"password must be at least {MIN_PASSWORD_CHARACTERS} characters")
    if len(password) > MAX_PASSWORD_CHARACTERS:
        raise ValueError(f"password must be at most {MAX_PASSWORD_CHARACTERS} characters")


def _bcrypt_material(password: str) -> bytes:
    # bcrypt silently truncates inputs after 72 bytes. Pre-hashing gives every
    # UTF-8 character influence over the verifier while bcrypt still supplies
    # the adaptive work factor and per-password salt.
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    validate_password_input(password)
    encoded = bcrypt.hashpw(_bcrypt_material(password), bcrypt.gensalt(rounds=12)).decode("ascii")
    return f"{PASSWORD_HASH_PREFIX}{encoded}"


def verify_password_hash(password: str, stored_hash: str) -> tuple[bool, bool]:
    """Return ``(valid, needs_upgrade)`` without exposing hash-format details upstream."""
    if not password or not stored_hash:
        return False, False
    if len(password) > MAX_PASSWORD_CHARACTERS:
        return False, False
    if stored_hash.startswith(PASSWORD_HASH_PREFIX):
        bcrypt_hash = stored_hash[len(PASSWORD_HASH_PREFIX):]
        try:
            return bcrypt.checkpw(_bcrypt_material(password), bcrypt_hash.encode("ascii")), False
        except (ValueError, TypeError):
            return False, False
    if stored_hash.startswith(BCRYPT_PREFIXES):
        try:
            valid = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("ascii"))
            return valid, valid
        except (ValueError, TypeError):
            return False, False

    legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
    valid = hmac.compare_digest(legacy, stored_hash)
    return valid, valid

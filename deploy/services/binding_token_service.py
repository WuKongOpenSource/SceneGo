"""Short-lived token used only while a legacy account binds a verified phone."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional


TOKEN_PREFIX = "bind"


def _secret() -> str:
    value = (os.getenv("OSTORY_VERIFICATION_CODE_SECRET") or "").strip()
    runtime = (os.getenv("OSTORY_RUNTIME_ENV") or "development").strip().lower()
    if len(value) >= 32:
        return value
    if runtime != "production":
        development_seed = "ostory-development-binding-token-digest"
        return hashlib.sha256(development_seed.encode("utf-8")).hexdigest()
    raise RuntimeError("OSTORY_VERIFICATION_CODE_SECRET must contain at least 32 characters")


def create_binding_token(user_id: str, ttl_seconds: int = 600) -> str:
    now = int(time.time())
    payload = json.dumps(
        {"sub": user_id, "scope": "bind_phone", "iat": now, "exp": now + ttl_seconds},
        separators=(",", ":"),
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    signature = hmac.new(_secret().encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{TOKEN_PREFIX}.{encoded}.{signature}"


def verify_binding_token(token: str) -> Optional[str]:
    try:
        prefix, encoded, signature = token.split(".", 2)
        if prefix != TOKEN_PREFIX:
            return None
        expected = hmac.new(_secret().encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if payload.get("scope") != "bind_phone" or int(payload.get("exp") or 0) < int(time.time()):
            return None
        return str(payload.get("sub") or "") or None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

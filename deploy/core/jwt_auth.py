



import hmac
import hashlib
import json
import base64
import time
import os
import secrets
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_secret_key: str = ""
MIN_PRODUCTION_SECRET_BYTES = 32


class JwtConfigurationError(RuntimeError):
    """Raised when production JWT signing configuration is unsafe."""


def _is_production_runtime() -> bool:
    return os.environ.get("OSTORY_RUNTIME_ENV", "development").strip().lower() == "production"


def _validate_production_secret(value: str) -> str:
    if len(value.encode("utf-8")) < MIN_PRODUCTION_SECRET_BYTES:
        raise JwtConfigurationError(
            "Production JWT_SECRET_KEY must contain at least 32 bytes of secret material"
        )
    return value


def _resolve_secret(secret_key: str = "") -> str:







    production = _is_production_runtime()
    if secret_key:
        return _validate_production_secret(secret_key) if production else secret_key
    env = os.environ.get("JWT_SECRET_KEY")
    if env:
        return _validate_production_secret(env) if production else env
    if production:
        raise JwtConfigurationError(
            "JWT_SECRET_KEY is required when OSTORY_RUNTIME_ENV=production"
        )
    secret_file = Path(__file__).resolve().parent.parent / ".jwt_secret"
    try:
        if secret_file.exists():
            val = secret_file.read_text(encoding="utf-8").strip()
            if val:
                return val
        new = secrets.token_urlsafe(48)
        secret_file.write_text(new, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except Exception:
            pass
        logger.warning(
            "⚠️ 未设置 JWT_SECRET_KEY，已生成随机密钥并持久化到 deploy/.jwt_secret"
            "（生产建议改用环境变量注入；本次更换会使旧令牌全部失效，需重新登录）"
        )
        return new
    except Exception as e:
        logger.error(
            f"无法持久化 JWT 密钥（{e}），改用进程内随机密钥；重启将使令牌失效。"
            "请设置 JWT_SECRET_KEY 环境变量。"
        )
        return secrets.token_urlsafe(48)


def init(secret_key: str = ""):

    global _secret_key
    _secret_key = _resolve_secret(secret_key)
    logger.info("✅ JWT 认证模块已初始化")


def ensure_initialized() -> None:
    """Initialize signing state when a process reaches a route before startup hooks."""
    if not _secret_key:
        init()

def create_token(username: str, ttl: int = 86400, *, session_version: int = 1) -> str:










    ensure_initialized()
    now = int(time.time())
    version = int(session_version)
    if version < 1:
        raise ValueError("session_version must be a positive integer")
    payload = json.dumps(
        {"u": username, "sv": version, "exp": now + ttl, "iat": now},
        separators=(',', ':'),
    )
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    sig = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"

def verify_token_claims(token: str) -> Optional[dict[str, Any]]:
    """Verify the token envelope and return its security claims.

    Tokens issued before session-version enforcement intentionally fail. This
    produces a one-time logout during upgrade instead of silently preserving a
    credential that cannot be revoked after password or account changes.
    """
    ensure_initialized()
    if not token or '.' not in token:
        return None
    try:
        payload_b64, sig = token.rsplit('.', 1)
        expected = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        data = json.loads(base64.urlsafe_b64decode(payload_b64))
        subject = data.get("u")
        session_version = data.get("sv")
        if not isinstance(subject, str) or not subject:
            return None
        if not isinstance(session_version, int) or isinstance(session_version, bool) or session_version < 1:
            return None
        if data.get("exp", 0) < time.time():
            logger.debug("Token 已过期: %s", subject)
            return None
        return data
    except Exception as e:
        logger.debug("Token 验证失败: %s", e)
        return None


def verify_token(token: str) -> Optional[str]:







    claims = verify_token_claims(token)
    return str(claims["u"]) if claims else None

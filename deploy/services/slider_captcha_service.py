"""Same-origin puzzle verification backed by expiring, single-use Redis records."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import math
import os
import re
import secrets
import time
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter

CAPTCHA_COOKIE = "ostory_captcha_session"
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
CAPTCHA_ACTIONS = frozenset({"login", "register", "sms_register", "sms_login", "sms_bind_phone", "sms_password_reset"})
_DEVELOPMENT_SECRET = secrets.token_urlsafe(32)


class CaptchaError(RuntimeError):
    pass


class CaptchaConfigurationError(CaptchaError):
    pass


class CaptchaInvalid(CaptchaError):
    pass


class CaptchaUnavailable(CaptchaError):
    pass


class CaptchaRateLimited(CaptchaError):
    retry_after = 60


@dataclass(frozen=True)
class CaptchaSettings:
    required: bool
    secret: str
    challenge_ttl: int = 120
    proof_ttl: int = 60
    ip_limit: int = 30
    global_limit: int = 600


def load_captcha_settings() -> CaptchaSettings:
    production = os.getenv("OSTORY_RUNTIME_ENV", "development").strip().lower() == "production"
    required = os.getenv("AUTH_CAPTCHA_REQUIRED", str(production)).lower() in {"true", "1", "yes", "on"}
    provider = os.getenv("AUTH_CAPTCHA_PROVIDER", "slider").strip().lower()
    secret = (os.getenv("OSTORY_CAPTCHA_SECRET") or os.getenv("OSTORY_VERIFICATION_CODE_SECRET") or "").strip()
    if required and provider != "slider":
        raise CaptchaConfigurationError("AUTH_CAPTCHA_PROVIDER must be slider")
    if required and production and len(secret) < 32:
        raise CaptchaConfigurationError("OSTORY_CAPTCHA_SECRET or OSTORY_VERIFICATION_CODE_SECRET must contain at least 32 characters")
    if not secret:
        secret = _DEVELOPMENT_SECRET
    return CaptchaSettings(required=required, secret=secret)


def validate_captcha_configuration() -> None:
    load_captcha_settings()


def public_captcha_config() -> dict:
    settings = load_captcha_settings()
    return {"enabled": settings.required, "provider": "slider" if settings.required else None, "site_key": None}


def _binding(settings: CaptchaSettings, session_id: str, remote_ip: str | None) -> str:
    if not TOKEN_PATTERN.fullmatch(session_id or ""):
        raise CaptchaInvalid("安全验证会话已失效，请刷新页面后重试")
    return hmac.new(settings.secret.encode(), f"slider:binding:{session_id}:{remote_ip or 'unknown'}".encode(), hashlib.sha256).hexdigest()


_RATE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count
"""

# Bind before deleting so a different session/action cannot consume the record.
_TAKE_SCRIPT = """
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local value = cjson.decode(raw)
if value.binding ~= ARGV[1] or value.action ~= ARGV[2] then return false end
redis.call('DEL', KEYS[1])
return raw
"""


async def _redis_call(redis_client, method: str, *args, **kwargs):
    if redis_client is None:
        raise CaptchaUnavailable("安全验证服务暂不可用，请稍后重试")
    try:
        return await asyncio.wait_for(getattr(redis_client, method)(*args, **kwargs), timeout=3)
    except Exception as exc:
        raise CaptchaUnavailable("安全验证服务暂不可用，请稍后重试") from exc


async def _limit(redis_client, settings: CaptchaSettings, remote_ip: str | None, stage: str):
    digest = hmac.new(settings.secret.encode(), f"slider:rate:{remote_ip or 'unknown'}".encode(), hashlib.sha256).hexdigest()
    for key, limit in ((f"auth:captcha:rate:{stage}:{digest}", settings.ip_limit), (f"auth:captcha:rate:{stage}:global", settings.global_limit)):
        count = await _redis_call(redis_client, "eval", _RATE_SCRIPT, 1, key)
        if int(count) > limit:
            raise CaptchaRateLimited("安全验证操作过于频繁，请稍后再试")


def _puzzle_images() -> tuple[dict, int]:
    """Render fresh procedural artwork without remote assets or public answer coordinates."""
    rng = secrets.SystemRandom()
    width, height, size = 320, 160, 56
    x, y = rng.randrange(88, width - size - 8), rng.randrange(16, height - size - 8)
    bg = Image.new("RGB", (width, height), (38, 70, 100))
    draw = ImageDraw.Draw(bg)
    palette = [(53, 119, 159), (46, 163, 143), (139, 113, 195), (231, 179, 104), (114, 165, 192)]
    for _ in range(55):
        left, top = rng.randrange(-40, width), rng.randrange(-30, height)
        draw.ellipse((left, top, left + rng.randrange(15, 115), top + rng.randrange(15, 100)), fill=rng.choice(palette))
    bg = bg.filter(ImageFilter.GaussianBlur(1.2))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((5, 11, 44, 50), radius=3, fill=255)
    md.ellipse((18, 2, 32, 19), fill=255)
    md.ellipse((37, 23, 53, 37), fill=255)
    md.ellipse((0, 23, 15, 38), fill=0)
    piece = bg.crop((x, y, x + size, y + size)).convert("RGBA")
    piece.putalpha(mask)
    shadow = Image.new("RGB", (size, size), (20, 28, 44))
    bg.paste(shadow, (x, y), mask.point(lambda value: round(value * 0.85)))
    bg.paste((230, 236, 255), (x, y), mask.filter(ImageFilter.FIND_EDGES))

    def encode(image, fmt):
        stream = io.BytesIO()
        image.save(stream, format=fmt)
        return f"data:image/{'jpeg' if fmt == 'JPEG' else 'png'};base64," + base64.b64encode(stream.getvalue()).decode()

    return {"background": encode(bg, "JPEG"), "piece": encode(piece, "PNG"), "width": width, "height": height, "piece_size": size, "y": y}, x


async def create_challenge(*, redis_client, session_id: str, remote_ip: str | None, action: str, settings: CaptchaSettings | None = None) -> dict:
    settings = settings or load_captcha_settings()
    if not settings.required or action not in CAPTCHA_ACTIONS:
        raise CaptchaInvalid("当前操作不支持安全验证")
    binding = _binding(settings, session_id, remote_ip)
    await _limit(redis_client, settings, remote_ip, "challenge")
    images, answer = await asyncio.to_thread(_puzzle_images)
    challenge_id = secrets.token_urlsafe(32)
    record = {"x": answer, "binding": binding, "action": action, "issued_at": time.time()}
    await _redis_call(redis_client, "set", f"auth:captcha:challenge:{challenge_id}", json.dumps(record), ex=settings.challenge_ttl)
    return {**images, "challenge_id": challenge_id, "expires_in": settings.challenge_ttl}


async def check_challenge(*, redis_client, session_id: str, remote_ip: str | None, action: str, challenge_id: str, x: float, settings: CaptchaSettings | None = None) -> dict:
    settings = settings or load_captcha_settings()
    if not settings.required or action not in CAPTCHA_ACTIONS or not TOKEN_PATTERN.fullmatch(challenge_id or ""):
        raise CaptchaInvalid("验证已失效，请换一张重试")
    binding = _binding(settings, session_id, remote_ip)
    await _limit(redis_client, settings, remote_ip, "check")
    raw = await _redis_call(redis_client, "eval", _TAKE_SCRIPT, 1, f"auth:captcha:challenge:{challenge_id}", binding, action)
    if not raw:
        raise CaptchaInvalid("验证已过期或已使用，请换一张重试")
    record = json.loads(raw)
    age = time.time() - float(record["issued_at"])
    if not math.isfinite(x) or abs(x - record["x"]) > 5 or not 0.25 <= age <= settings.challenge_ttl:
        raise CaptchaInvalid("未对齐缺口，请换一张重试")
    token = secrets.token_urlsafe(32)
    await _redis_call(redis_client, "set", f"auth:captcha:proof:{token}", json.dumps({"binding": binding, "action": action}), ex=settings.proof_ttl)
    return {"captcha_verification": "slider." + token, "expires_in": settings.proof_ttl}


async def verify_captcha(response_token: str | None, *, remote_ip: str | None, expected_action: str, redis_client=None, session_id: str = "", settings: CaptchaSettings | None = None) -> None:
    settings = settings or load_captcha_settings()
    if not settings.required:
        return
    token = (response_token or "").removeprefix("slider.")
    if not (response_token or "").startswith("slider.") or not TOKEN_PATTERN.fullmatch(token) or expected_action not in CAPTCHA_ACTIONS:
        raise CaptchaInvalid("请先完成滑块安全验证")
    binding = _binding(settings, session_id, remote_ip)
    raw = await _redis_call(redis_client, "eval", _TAKE_SCRIPT, 1, f"auth:captcha:proof:{token}", binding, expected_action)
    if not raw:
        raise CaptchaInvalid("安全验证已过期或已使用，请重新拖动滑块")

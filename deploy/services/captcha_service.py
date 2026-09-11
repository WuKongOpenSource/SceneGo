"""Compatibility surface for authentication CAPTCHA consumers.

The self-hosted slider is canonical; keep imports stable across legacy login routes.
"""
from services.slider_captcha_service import (
    CAPTCHA_COOKIE, TOKEN_PATTERN, CaptchaError, CaptchaConfigurationError,
    CaptchaInvalid, CaptchaUnavailable, CaptchaRateLimited, CaptchaSettings,
    load_captcha_settings, validate_captcha_configuration, public_captcha_config,
    create_challenge, check_challenge, verify_captcha,
)

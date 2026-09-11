"""Environment-backed WeChat Pay APIv3 configuration.

Private keys and APIv3 secrets are read from files so they never need to be
embedded in source code, container images, process arguments, or admin JSON.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional


class WechatPayConfigurationError(RuntimeError):
    """Raised when an enabled payment channel is incomplete or unsafe."""


def _positive_int(value: Optional[str], fallback: int) -> int:
    try:
        parsed = int(str(value or '').strip())
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


@dataclass(frozen=True)
class WechatPayConfig:
    enabled: bool
    app_id: str
    merchant_id: str
    merchant_serial_no: str
    merchant_private_key_path: str
    api_v3_key_path: str
    public_key_id: str
    public_key_path: str
    notify_url: str
    order_expire_minutes: int
    max_point_amount: int

    def validate_enabled(self) -> None:
        if not self.enabled:
            raise WechatPayConfigurationError("微信支付当前未启用")
        required = {
            'OSTORY_WECHAT_PAY_APP_ID': self.app_id,
            'OSTORY_WECHAT_PAY_MCH_ID': self.merchant_id,
            'OSTORY_WECHAT_PAY_MERCHANT_SERIAL_NO': self.merchant_serial_no,
            'OSTORY_WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH': self.merchant_private_key_path,
            'OSTORY_WECHAT_PAY_API_V3_KEY_PATH': self.api_v3_key_path,
            'OSTORY_WECHAT_PAY_PUBLIC_KEY_ID': self.public_key_id,
            'OSTORY_WECHAT_PAY_PUBLIC_KEY_PATH': self.public_key_path,
            'OSTORY_WECHAT_PAY_NOTIFY_URL': self.notify_url,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise WechatPayConfigurationError(f"微信支付缺少配置：{', '.join(missing)}")
        if not self.notify_url.startswith('https://'):
            raise WechatPayConfigurationError("微信支付回调地址必须使用公网 HTTPS")
        if not 1 <= self.order_expire_minutes <= 120:
            raise WechatPayConfigurationError("微信支付订单有效期必须在 1 到 120 分钟之间")


def read_wechat_pay_config(
    env: Mapping[str, str] = os.environ,
) -> WechatPayConfig:
    return WechatPayConfig(
        enabled=str(env.get('OSTORY_WECHAT_PAY_ENABLED', 'false')).lower() == 'true',
        app_id=str(env.get('OSTORY_WECHAT_PAY_APP_ID', '')).strip(),
        merchant_id=str(env.get('OSTORY_WECHAT_PAY_MCH_ID', '')).strip(),
        merchant_serial_no=str(env.get('OSTORY_WECHAT_PAY_MERCHANT_SERIAL_NO', '')).strip(),
        merchant_private_key_path=str(env.get('OSTORY_WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', '')).strip(),
        api_v3_key_path=str(env.get('OSTORY_WECHAT_PAY_API_V3_KEY_PATH', '')).strip(),
        public_key_id=str(env.get('OSTORY_WECHAT_PAY_PUBLIC_KEY_ID', '')).strip(),
        public_key_path=str(env.get('OSTORY_WECHAT_PAY_PUBLIC_KEY_PATH', '')).strip(),
        notify_url=str(env.get('OSTORY_WECHAT_PAY_NOTIFY_URL', '')).strip(),
        order_expire_minutes=_positive_int(env.get('OSTORY_WECHAT_PAY_ORDER_EXPIRE_MINUTES'), 30),
        max_point_amount=_positive_int(env.get('OSTORY_WECHAT_PAY_MAX_POINT_AMOUNT'), 1_000_000),
    )


def _read_secret(path: str, label: str) -> str:
    try:
        value = Path(path).expanduser().resolve().read_text(encoding='utf-8').strip()
    except (OSError, UnicodeError) as exc:
        raise WechatPayConfigurationError(f"无法读取{label}文件") from exc
    if not value:
        raise WechatPayConfigurationError(f"{label}文件为空")
    return value


def read_wechat_pay_key_materials(config: WechatPayConfig) -> tuple[str, str, bytes]:
    config.validate_enabled()
    merchant_private_key = _read_secret(config.merchant_private_key_path, '微信支付商户私钥')
    public_key = _read_secret(config.public_key_path, '微信支付公钥')
    api_v3_key = _read_secret(config.api_v3_key_path, '微信支付 APIv3 密钥').encode('utf-8')
    if 'PRIVATE KEY' not in merchant_private_key:
        raise WechatPayConfigurationError("微信支付商户私钥格式无效")
    if 'PUBLIC KEY' not in public_key:
        raise WechatPayConfigurationError("微信支付公钥格式无效")
    if len(api_v3_key) != 32:
        raise WechatPayConfigurationError("微信支付 APIv3 密钥必须正好为 32 字节")
    return merchant_private_key, public_key, api_v3_key

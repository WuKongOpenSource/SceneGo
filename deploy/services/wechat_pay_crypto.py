"""Signing, response verification, and callback decryption for WeChat Pay v3."""
from __future__ import annotations

import base64
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class WechatPaySignatureError(RuntimeError):
    """Untrusted or stale WeChat Pay signed data."""


@dataclass(frozen=True)
class WechatPaySignatureHeaders:
    timestamp: str
    nonce: str
    signature: str
    serial: str


def build_merchant_authorization(
    *,
    method: str,
    url: str,
    body: str,
    merchant_id: str,
    merchant_serial_no: str,
    merchant_private_key_pem: str,
    now_seconds: int | None = None,
    nonce: str | None = None,
) -> str:
    timestamp = str(int(time.time()) if now_seconds is None else int(now_seconds))
    nonce_value = nonce or secrets.token_hex(16)
    parsed = urlsplit(url)
    canonical_url = parsed.path + (f'?{parsed.query}' if parsed.query else '')
    message = f"{method.upper()}\n{canonical_url}\n{timestamp}\n{nonce_value}\n{body}\n".encode()
    private_key = serialization.load_pem_private_key(
        merchant_private_key_pem.encode('utf-8'),
        password=None,
    )
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
    encoded = base64.b64encode(signature).decode('ascii')
    return (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{merchant_id}",nonce_str="{nonce_value}",timestamp="{timestamp}",'
        f'serial_no="{merchant_serial_no}",signature="{encoded}"'
    )


def verify_wechat_pay_signature(
    *,
    headers: WechatPaySignatureHeaders,
    body: str,
    expected_serial: str,
    public_key_pem: str,
    now_seconds: int | None = None,
    max_age_seconds: int = 300,
) -> None:
    if not all((headers.timestamp, headers.nonce, headers.signature, headers.serial)):
        raise WechatPaySignatureError("微信支付签名请求头不完整")
    if not secrets.compare_digest(headers.serial, expected_serial):
        raise WechatPaySignatureError("微信支付签名公钥 ID 不匹配")
    try:
        timestamp = int(headers.timestamp)
    except (TypeError, ValueError) as exc:
        raise WechatPaySignatureError("微信支付签名时间戳无效") from exc
    now = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now - timestamp) > max_age_seconds:
        raise WechatPaySignatureError("微信支付签名时间戳已过期")
    try:
        signature = base64.b64decode(headers.signature, validate=True)
        public_key = serialization.load_pem_public_key(public_key_pem.encode('utf-8'))
        public_key.verify(
            signature,
            f"{headers.timestamp}\n{headers.nonce}\n{body}\n".encode(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except (ValueError, TypeError, InvalidSignature) as exc:
        raise WechatPaySignatureError("微信支付签名验证失败") from exc


def decrypt_wechat_pay_resource(
    *,
    ciphertext: str,
    nonce: str,
    associated_data: str,
    api_v3_key: bytes,
) -> str:
    try:
        encrypted = base64.b64decode(ciphertext, validate=True)
        plaintext = AESGCM(api_v3_key).decrypt(
            nonce.encode('utf-8'),
            encrypted,
            associated_data.encode('utf-8'),
        )
        return plaintext.decode('utf-8')
    except (ValueError, UnicodeError, InvalidTag) as exc:
        raise WechatPaySignatureError("微信支付回调资源解密失败") from exc

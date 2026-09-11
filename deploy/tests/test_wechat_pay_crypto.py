import base64
import json

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from services.wechat_pay_crypto import (
    WechatPaySignatureError,
    WechatPaySignatureHeaders,
    build_merchant_authorization,
    decrypt_wechat_pay_resource,
    verify_wechat_pay_signature,
)


@pytest.fixture
def rsa_keys():
    private_key = rsa.generate_private_key(public_exponent=65_537, key_size=2_048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_key, private_pem, public_pem


def test_merchant_authorization_signs_canonical_method_path_query_and_body(rsa_keys):
    private_key, private_pem, _public_pem = rsa_keys
    body = '{"amount":1000}'
    authorization = build_merchant_authorization(
        method="POST",
        url="https://api.mch.weixin.qq.com/v3/pay/transactions/native?mchid=123",
        body=body,
        merchant_id="123",
        merchant_serial_no="SERIAL",
        merchant_private_key_pem=private_pem,
        now_seconds=1_700_000_000,
        nonce="nonce-value",
    )
    encoded = authorization.split('signature="', 1)[1].rstrip('"')
    signature = base64.b64decode(encoded)

    private_key.public_key().verify(
        signature,
        b"POST\n/v3/pay/transactions/native?mchid=123\n1700000000\nnonce-value\n{\"amount\":1000}\n",
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def test_wechat_response_signature_and_timestamp_are_verified(rsa_keys):
    private_key, _private_pem, public_pem = rsa_keys
    body = json.dumps({"trade_state": "SUCCESS"}, separators=(",", ":"))
    timestamp = "1700000000"
    nonce = "provider-nonce"
    signature = private_key.sign(
        f"{timestamp}\n{nonce}\n{body}\n".encode(),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    headers = WechatPaySignatureHeaders(
        timestamp=timestamp,
        nonce=nonce,
        signature=base64.b64encode(signature).decode(),
        serial="PUB_ID",
    )

    verify_wechat_pay_signature(
        headers=headers,
        body=body,
        expected_serial="PUB_ID",
        public_key_pem=public_pem,
        now_seconds=1_700_000_100,
    )
    with pytest.raises(WechatPaySignatureError, match="已过期"):
        verify_wechat_pay_signature(
            headers=headers,
            body=body,
            expected_serial="PUB_ID",
            public_key_pem=public_pem,
            now_seconds=1_700_001_000,
        )


def test_callback_resource_aes_gcm_decryption():
    key = b"0123456789abcdef0123456789abcdef"
    nonce = b"nonce-123456"
    associated = b"transaction"
    plaintext = b'{"out_trade_no":"CJ1"}'
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, associated)

    assert decrypt_wechat_pay_resource(
        ciphertext=base64.b64encode(ciphertext).decode(),
        nonce=nonce.decode(),
        associated_data=associated.decode(),
        api_v3_key=key,
    ) == plaintext.decode()

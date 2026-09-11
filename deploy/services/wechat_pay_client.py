"""Minimal async WeChat Pay APIv3 Native client with response verification."""
from __future__ import annotations

import json
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from services.wechat_pay_config import (
    WechatPayConfig,
    read_wechat_pay_key_materials,
)
from services.wechat_pay_crypto import (
    WechatPaySignatureHeaders,
    build_merchant_authorization,
    verify_wechat_pay_signature,
)

WECHAT_PAY_GATEWAY = 'https://api.mch.weixin.qq.com'


class WechatPayAPIError(RuntimeError):
    def __init__(self, message: str, *, code: str = '', request_id: str = ''):
        super().__init__(message)
        self.code = code
        self.request_id = request_id


async def _request(
    *,
    method: str,
    path: str,
    config: WechatPayConfig,
    body: Optional[Dict[str, Any]] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> tuple[Dict[str, Any], str]:
    merchant_private_key, public_key, _api_v3_key = read_wechat_pay_key_materials(config)
    raw_body = '' if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    url = f'{WECHAT_PAY_GATEWAY}{path}'
    authorization = build_merchant_authorization(
        method=method,
        url=url,
        body=raw_body,
        merchant_id=config.merchant_id,
        merchant_serial_no=config.merchant_serial_no,
        merchant_private_key_pem=merchant_private_key,
    )
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=15.0)
    try:
        response = await http_client.request(
            method,
            url,
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': authorization,
            },
            content=raw_body.encode('utf-8') if raw_body else None,
        )
    finally:
        if owns_client:
            await http_client.aclose()

    response_body = response.text
    verify_wechat_pay_signature(
        headers=WechatPaySignatureHeaders(
            timestamp=response.headers.get('Wechatpay-Timestamp', ''),
            nonce=response.headers.get('Wechatpay-Nonce', ''),
            signature=response.headers.get('Wechatpay-Signature', ''),
            serial=response.headers.get('Wechatpay-Serial', ''),
        ),
        body=response_body,
        expected_serial=config.public_key_id,
        public_key_pem=public_key,
    )
    request_id = response.headers.get('Request-ID', '')
    try:
        payload = response.json() if response_body else {}
    except ValueError as exc:
        raise WechatPayAPIError('微信支付返回了无法解析的响应', request_id=request_id) from exc
    if response.status_code >= 400:
        raise WechatPayAPIError(
            str(payload.get('message') or '微信支付接口调用失败'),
            code=str(payload.get('code') or ''),
            request_id=request_id,
        )
    return payload, request_id


async def create_native_order(
    *,
    config: WechatPayConfig,
    description: str,
    out_trade_no: str,
    amount_fen: int,
    expires_at_rfc3339: str,
    attach: str,
) -> tuple[Dict[str, Any], str]:
    return await _request(
        method='POST',
        path='/v3/pay/transactions/native',
        config=config,
        body={
            'appid': config.app_id,
            'mchid': config.merchant_id,
            'description': description,
            'out_trade_no': out_trade_no,
            'time_expire': expires_at_rfc3339,
            'attach': attach,
            'notify_url': config.notify_url,
            'amount': {'total': amount_fen, 'currency': 'CNY'},
        },
    )


async def query_native_order(
    *, config: WechatPayConfig, out_trade_no: str,
) -> tuple[Dict[str, Any], str]:
    return await _request(
        method='GET',
        path=(f'/v3/pay/transactions/out-trade-no/{quote(out_trade_no, safe="")}'
              f'?mchid={quote(config.merchant_id, safe="")}'),
        config=config,
    )


async def close_native_order(*, config: WechatPayConfig, out_trade_no: str) -> None:
    encoded_trade_no = quote(out_trade_no, safe='')
    await _request(
        method='POST',
        path=f'/v3/pay/transactions/out-trade-no/{encoded_trade_no}/close',
        config=config,
        body={'mchid': config.merchant_id},
    )

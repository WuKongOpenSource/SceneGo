"""WeChat Native recharge lifecycle for permanent account creation points.

Pricing, local order state, payment verification, and point crediting live in
one service so the browser can never choose the payable amount or credit grant.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Mapping, Optional

from dao.business.wechat_recharge import (
    RechargeOrderNotFound,
    RechargeOrderStateError,
    RechargeTransactionConflict,
    WechatRechargeDAO,
)
from services.wechat_pay_client import (
    close_native_order,
    create_native_order,
    query_native_order,
)
from services.wechat_pay_config import (
    WechatPayConfig,
    read_wechat_pay_config,
    read_wechat_pay_key_materials,
)
from services.wechat_pay_crypto import (
    WechatPaySignatureHeaders,
    decrypt_wechat_pay_resource,
    verify_wechat_pay_signature,
)

logger = logging.getLogger(__name__)


class WechatRechargeError(RuntimeError):
    """Safe, user-facing payment lifecycle error."""


DISCOUNT_TIERS = (
    # min points, discount basis points, label, minimum payable fen. The floors
    # make the reference offers exact: 102/526/1111/2500 points cost
    # ¥10/¥50/¥100/¥200 respectively, while still allowing any integer amount.
    (2_500, 8_000, '8 折', 20_000),
    (1_111, 9_000, '9 折', 10_000),
    (526, 9_500, '9.5 折', 5_000),
    (102, 9_800, '9.8 折', 1_000),
)
SUGGESTED_POINT_AMOUNTS = (102, 526, 1_111, 2_500)
AMOUNT_DISCOUNT_TIERS = (
    # min payable fen, discount basis points, label
    (20_000, 8_000, '8 折'),
    (10_000, 9_000, '9 折'),
    (5_000, 9_500, '9.5 折'),
    (1_000, 9_800, '9.8 折'),
)


def quote_recharge(point_amount: int, *, max_point_amount: int = 1_000_000) -> Dict[str, Any]:
    if isinstance(point_amount, bool) or not isinstance(point_amount, int):
        raise WechatRechargeError('充值点数必须是整数')
    if point_amount < 1:
        raise WechatRechargeError('充值点数必须大于 0')
    if point_amount > max_point_amount:
        raise WechatRechargeError(f'单笔充值不能超过 {max_point_amount:,} 点')

    # Base ratio: ¥1 = 10 points, therefore one point has a list price of 10 fen.
    base_amount_fen = point_amount * 10
    discount_bps = 10_000
    tier_name = '无折扣'
    minimum_pay_fen = 0
    for threshold_points, candidate_bps, candidate_name, candidate_minimum_pay in DISCOUNT_TIERS:
        if point_amount >= threshold_points:
            discount_bps = candidate_bps
            tier_name = candidate_name
            minimum_pay_fen = candidate_minimum_pay
            break
    # Half-up rounding is deterministic and avoids floating-point price drift.
    amount_fen = max(
        minimum_pay_fen,
        (base_amount_fen * discount_bps + 5_000) // 10_000,
    )
    return {
        'point_amount': point_amount,
        'base_amount_fen': base_amount_fen,
        'discount_bps': discount_bps,
        'discount_label': tier_name,
        'amount_fen': amount_fen,
        'saved_amount_fen': base_amount_fen - amount_fen,
        'currency': 'CNY',
    }


def quote_recharge_amount(amount_fen: int, *, max_point_amount: int = 1_000_000) -> Dict[str, Any]:
    """Quote an exact user-selected payable amount in fen.

    The point grant is always rounded down to a whole point. This keeps the
    payable amount exact and prevents the browser from manufacturing points.
    At the tier anchors ¥10/¥50/¥100/¥200 this yields exactly
    102/526/1111/2500 points.
    """
    if isinstance(amount_fen, bool) or not isinstance(amount_fen, int):
        raise WechatRechargeError('充值金额必须精确到分')
    if amount_fen < 10:
        raise WechatRechargeError('单笔充值金额不能低于 0.10 元')

    discount_bps = 10_000
    tier_name = '无折扣'
    for threshold_fen, candidate_bps, candidate_name in AMOUNT_DISCOUNT_TIERS:
        if amount_fen >= threshold_fen:
            discount_bps = candidate_bps
            tier_name = candidate_name
            break
    point_amount = (amount_fen * 10_000) // (10 * discount_bps)
    if point_amount < 1:
        raise WechatRechargeError('充值金额不足以兑换 1 个创作点数')
    if point_amount > max_point_amount:
        raise WechatRechargeError(f'单笔充值不能超过 {max_point_amount:,} 点')
    base_amount_fen = point_amount * 10
    return {
        'point_amount': point_amount,
        'base_amount_fen': base_amount_fen,
        'discount_bps': discount_bps,
        'discount_label': tier_name,
        'amount_fen': amount_fen,
        'saved_amount_fen': max(0, base_amount_fen - amount_fen),
        'currency': 'CNY',
    }


def get_payment_options(config: Optional[WechatPayConfig] = None) -> Dict[str, Any]:
    config = config or read_wechat_pay_config()
    return {
        'enabled': config.enabled,
        'base_ratio': {'cny_yuan': 1, 'creation_points': 10},
        'max_point_amount': config.max_point_amount,
        'max_amount_fen': quote_recharge(
            config.max_point_amount,
            max_point_amount=config.max_point_amount,
        )['amount_fen'],
        'discount_tiers': [
            {
                'min_point_amount': threshold,
                'min_pay_amount_fen': minimum_pay,
                'discount_bps': bps,
                'label': label,
            }
            for threshold, bps, label, minimum_pay in reversed(DISCOUNT_TIERS)
        ],
        'suggestions': [
            quote_recharge(points, max_point_amount=config.max_point_amount)
            for points in SUGGESTED_POINT_AMOUNTS
            if points <= config.max_point_amount
        ],
    }


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _rfc3339(value: datetime) -> str:
    return _utc(value).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _serialize_order(row: Mapping[str, Any]) -> Dict[str, Any]:
    data = dict(row)
    for key in ('expires_at', 'paid_at', 'created_at', 'updated_at'):
        value = data.get(key)
        data[key] = _utc(value).isoformat() if isinstance(value, datetime) else None
    data['status'] = str(data.get('status') or '').upper()
    return data


def _out_trade_no() -> str:
    # 2 + 11-ish hex timestamp + 16 random hex chars stays within WeChat's 32-char limit.
    return f"CJ{int(time.time() * 1000):X}{secrets.token_hex(8).upper()}"[:32]


async def create_recharge_order(
    user_id: str,
    *,
    point_amount: Optional[int] = None,
    amount_fen: Optional[int] = None,
) -> Dict[str, Any]:
    config = read_wechat_pay_config()
    config.validate_enabled()
    if (point_amount is None) == (amount_fen is None):
        raise WechatRechargeError('充值点数和充值金额必须且只能填写一项')
    quote = (
        quote_recharge(point_amount, max_point_amount=config.max_point_amount)
        if point_amount is not None
        else quote_recharge_amount(amount_fen, max_point_amount=config.max_point_amount)
    )
    point_amount = int(quote['point_amount'])
    now = datetime.now(timezone.utc)
    reusable = await WechatRechargeDAO.find_reusable_order(
        user_id,
        point_amount,
        quote['amount_fen'],
        now,
    )
    if reusable:
        return _serialize_order(reusable)

    payment_order_id = f"pay_{uuid.uuid4().hex[:24]}"
    out_trade_no = _out_trade_no()
    expires_at = now + timedelta(minutes=config.order_expire_minutes)
    order = await WechatRechargeDAO.create_order(
        payment_order_id=payment_order_id,
        user_id=user_id,
        out_trade_no=out_trade_no,
        point_amount=point_amount,
        base_amount_fen=quote['base_amount_fen'],
        discount_bps=quote['discount_bps'],
        amount_fen=quote['amount_fen'],
        expires_at=expires_at,
    )
    try:
        payload, request_id = await create_native_order(
            config=config,
            description='创剧-创作点数充值',
            out_trade_no=out_trade_no,
            amount_fen=quote['amount_fen'],
            expires_at_rfc3339=_rfc3339(expires_at),
            attach=payment_order_id,
        )
        code_url = str(payload.get('code_url') or '')
        if not code_url:
            raise WechatRechargeError('微信支付未返回扫码链接')
        order = await WechatRechargeDAO.mark_order_ready(
            payment_order_id,
            code_url=code_url,
            request_id=request_id or None,
        )
        return _serialize_order(order)
    except Exception as exc:
        # Persist a safe failure summary. Never store key material, signed headers,
        # raw callback bodies, or provider credential details in the order table.
        safe_message = str(exc)[:500] or '微信支付下单失败'
        await WechatRechargeDAO.mark_order_failed(payment_order_id, safe_message)
        raise WechatRechargeError(safe_message) from exc


def _require_transaction(payload: Mapping[str, Any]) -> Dict[str, Any]:
    amount = payload.get('amount')
    if not isinstance(amount, Mapping):
        raise WechatRechargeError('微信支付交易金额缺失')
    required_text = ('appid', 'mchid', 'out_trade_no', 'transaction_id', 'trade_state')
    result = {key: str(payload.get(key) or '') for key in required_text}
    if not all(result.values()):
        raise WechatRechargeError('微信支付交易字段不完整')
    try:
        total = int(amount.get('total'))
    except (TypeError, ValueError) as exc:
        raise WechatRechargeError('微信支付交易金额无效') from exc
    result['amount'] = {'total': total, 'currency': str(amount.get('currency') or '')}
    result['success_time'] = str(payload.get('success_time') or '')
    return result


async def settle_recharge(
    transaction_payload: Mapping[str, Any],
    *,
    notify_event_id: str = '',
    config: Optional[WechatPayConfig] = None,
) -> Dict[str, Any]:
    config = config or read_wechat_pay_config()
    config.validate_enabled()
    transaction = _require_transaction(transaction_payload)
    if transaction['trade_state'] != 'SUCCESS':
        raise WechatRechargeError('微信支付交易状态不是 SUCCESS')

    paid_at = datetime.now(timezone.utc)
    if transaction['success_time']:
        try:
            paid_at = datetime.fromisoformat(transaction['success_time'].replace('Z', '+00:00'))
        except ValueError as exc:
            raise WechatRechargeError('微信支付成功时间无效') from exc

    def validate_order(order: Mapping[str, Any]) -> None:
        if (
            transaction['mchid'] != config.merchant_id
            or transaction['appid'] != config.app_id
            or transaction['amount']['total'] != int(order['amount_fen'])
            or transaction['amount']['currency'] != str(order['currency'])
        ):
            raise WechatRechargeError('微信支付交易信息与本地订单不一致')

    try:
        updated = await WechatRechargeDAO.settle_order(
            out_trade_no=transaction['out_trade_no'],
            transaction_id=transaction['transaction_id'],
            notify_event_id=notify_event_id,
            paid_at=paid_at,
            validate_order=validate_order,
        )
    except RechargeOrderNotFound as exc:
        raise WechatRechargeError('微信支付订单不存在') from exc
    except RechargeTransactionConflict as exc:
        raise WechatRechargeError('已支付订单的微信交易号不一致') from exc
    except RechargeOrderStateError as exc:
        raise WechatRechargeError(f'当前订单状态 {exc.status} 不允许确认支付') from exc
    return _serialize_order(updated)


async def get_recharge_order(user_id: str, out_trade_no: str) -> Optional[Dict[str, Any]]:
    row = await WechatRechargeDAO.get_user_order(user_id, out_trade_no)
    if not row:
        return None
    order = dict(row)
    now = datetime.now(timezone.utc)
    last_checked = order.get('last_checked_at')
    should_query = (
        order['status'] == 'pending'
        and (not last_checked or (now - _utc(last_checked)).total_seconds() >= 8)
    )
    if should_query:
        try:
            config = read_wechat_pay_config()
            payload, request_id = await query_native_order(
                config=config,
                out_trade_no=out_trade_no,
            )
            state = str(payload.get('trade_state') or '')
            if state == 'SUCCESS' and payload.get('transaction_id'):
                return await settle_recharge(payload, config=config)
            if state in ('CLOSED', 'REVOKED', 'PAYERROR'):
                row = await WechatRechargeDAO.update_provider_state(
                    user_id,
                    out_trade_no,
                    status='closed' if state == 'CLOSED' else 'failed',
                    failure_reason=str(payload.get('trade_state_desc') or state)[:500],
                    request_id=request_id or None,
                )
                order = dict(row)
            else:
                row = await WechatRechargeDAO.mark_checked(
                    user_id,
                    out_trade_no,
                    request_id=request_id or None,
                )
                order = dict(row)
        except Exception:
            # The signed callback is the primary settlement path. A transient
            # active-query error keeps the order pending for the next poll.
            logger.warning('WeChat order query failed out_trade_no=%s', out_trade_no, exc_info=True)

    if order['status'] == 'pending' and _utc(order['expires_at']) <= now:
        try:
            await close_native_order(config=read_wechat_pay_config(), out_trade_no=out_trade_no)
        except Exception:
            logger.info('WeChat close order deferred out_trade_no=%s', out_trade_no, exc_info=True)
        row = await WechatRechargeDAO.mark_expired(user_id, out_trade_no)
        if row:
            order = dict(row)
    return _serialize_order(order)


async def handle_wechat_notification(headers: Mapping[str, str], raw_body: str) -> Dict[str, Any]:
    config = read_wechat_pay_config()
    _merchant_key, public_key, api_v3_key = read_wechat_pay_key_materials(config)
    lower_headers = {str(k).lower(): str(v) for k, v in headers.items()}
    verify_wechat_pay_signature(
        headers=WechatPaySignatureHeaders(
            timestamp=lower_headers.get('wechatpay-timestamp', ''),
            nonce=lower_headers.get('wechatpay-nonce', ''),
            signature=lower_headers.get('wechatpay-signature', ''),
            serial=lower_headers.get('wechatpay-serial', ''),
        ),
        body=raw_body,
        expected_serial=config.public_key_id,
        public_key_pem=public_key,
    )
    try:
        notification = json.loads(raw_body)
        if (
            notification.get('event_type') != 'TRANSACTION.SUCCESS'
            or notification.get('resource_type') != 'encrypt-resource'
        ):
            raise WechatRechargeError('微信支付通知类型不受支持')
        resource = notification['resource']
        if (
            resource.get('original_type') != 'transaction'
            or resource.get('algorithm') != 'AEAD_AES_256_GCM'
        ):
            raise WechatRechargeError('微信支付通知资源格式无效')
        decrypted = decrypt_wechat_pay_resource(
            ciphertext=str(resource['ciphertext']),
            nonce=str(resource['nonce']),
            associated_data=str(resource.get('associated_data') or ''),
            api_v3_key=api_v3_key,
        )
        transaction = json.loads(decrypted)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise WechatRechargeError('微信支付通知内容无效') from exc
    return await settle_recharge(
        transaction,
        notify_event_id=str(notification.get('id') or ''),
        config=config,
    )


async def list_recharge_orders(
    *,
    user_id: str = '',
    status: str = '',
    out_trade_no: str = '',
    limit: int = 100,
    offset: int = 0,
) -> list[Dict[str, Any]]:
    rows = await WechatRechargeDAO.list_orders(
        user_id=user_id,
        status=status,
        out_trade_no=out_trade_no,
        limit=limit,
        offset=offset,
    )
    return [_serialize_order(row) for row in rows]

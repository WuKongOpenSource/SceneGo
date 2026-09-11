"""Authenticated recharge endpoints plus the public signed WeChat callback."""
from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.wechat_recharge_service import (
    WechatRechargeError,
    create_recharge_order,
    get_payment_options,
    get_recharge_order,
    handle_wechat_notification,
    quote_recharge,
    quote_recharge_amount,
)
from services.wechat_pay_config import WechatPayConfigurationError, read_wechat_pay_config


class RechargeQuoteRequest(BaseModel):
    point_amount: Optional[int] = Field(default=None, gt=0)
    amount_fen: Optional[int] = Field(default=None, gt=0)


def _quote_request(body: RechargeQuoteRequest):
    if (body.point_amount is None) == (body.amount_fen is None):
        raise WechatRechargeError('充值点数和充值金额必须且只能填写一项')
    config = read_wechat_pay_config()
    if body.point_amount is not None:
        return quote_recharge(body.point_amount, max_point_amount=config.max_point_amount)
    return quote_recharge_amount(body.amount_fen, max_point_amount=config.max_point_amount)


def create_wechat_pay_router(
    *,
    get_current_user_dependency: Callable[..., Any],
    logger,
) -> APIRouter:
    router = APIRouter(prefix='/api/payments/wechat', tags=['wechat-pay'])

    @router.get('/options')
    async def options(_user_id: str = Depends(get_current_user_dependency)):
        try:
            return {'success': True, **get_payment_options()}
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post('/quote')
    async def quote(
        body: RechargeQuoteRequest,
        _user_id: str = Depends(get_current_user_dependency),
    ):
        try:
            return {'success': True, 'quote': _quote_request(body)}
        except WechatRechargeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post('/orders', status_code=201)
    async def create_order(
        body: RechargeQuoteRequest,
        user_id: str = Depends(get_current_user_dependency),
    ):
        try:
            return {
                'success': True,
                'order': await create_recharge_order(
                    user_id,
                    point_amount=body.point_amount,
                    amount_fen=body.amount_fen,
                ),
            }
        except (WechatRechargeError, WechatPayConfigurationError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @router.get('/orders/{out_trade_no}')
    async def get_order(
        out_trade_no: str,
        user_id: str = Depends(get_current_user_dependency),
    ):
        order = await get_recharge_order(user_id, out_trade_no)
        if not order:
            raise HTTPException(status_code=404, detail='充值订单不存在')
        return {'success': True, 'order': order}

    @router.post('/notify')
    async def notify(request: Request):
        raw_body = (await request.body()).decode('utf-8')
        try:
            await handle_wechat_notification(dict(request.headers), raw_body)
            return {'code': 'SUCCESS', 'message': '成功'}
        except Exception:
            # WeChat requires a generic failure response; detailed verification
            # failures belong only in server logs and must not echo signed data.
            logger.error('WeChat payment callback rejected', exc_info=True)
            return JSONResponse(
                status_code=500,
                content={'code': 'FAIL', 'message': '失败'},
            )

    return router

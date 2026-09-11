





from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import credit_service
from services.request_auth_service import get_current_user
from dao_credit import CreditAccountDAO, CreditTransactionDAO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/credits", tags=["credits"])



class CreditEstimateRequest(BaseModel):
    feature_key: str
    params: Optional[Dict[str, Any]] = None


class CreditConsumeRequest(BaseModel):
    feature_key: str
    task_id: str
    params: Optional[Dict[str, Any]] = None
    project_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None




@router.get("/balance")
async def get_balance(user_id: str = Depends(get_current_user)):

    try:
        account = await CreditAccountDAO.get_or_create('user', user_id)
        return {
            "success": True,
            "account_id": account['account_id'],
            "available_credits": int(account.get('available_credits') or 0),
            "account_credits": int(account.get('account_credits') or 0),
            "gift_credits": int(account.get('gift_credits') or 0),
            "gift_expires_at": account.get('gift_expires_at'),
            "frozen_credits": int(account.get('frozen_credits') or 0),
            "total_used_credits": int(account.get('total_used_credits') or 0),
        }
    except Exception as e:
        logger.error(f"获取创作点数余额失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/estimate")
async def estimate_credits(
    payload: CreditEstimateRequest,
    user_id: str = Depends(get_current_user),
):

    if not payload.feature_key:
        raise HTTPException(status_code=400, detail="feature_key 不能为空")
    try:
        result = await credit_service.estimate(
            payload.feature_key,
            payload.params or {},
            owner_type='user',
            owner_id=user_id,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"创作点数估算失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/consume")
async def consume_credits(
    payload: CreditConsumeRequest,
    user_id: str = Depends(get_current_user),
):

    if not payload.feature_key or not payload.task_id:
        raise HTTPException(status_code=400, detail="feature_key 和 task_id 不能为空")
    try:
        result = await credit_service.consume_usage(
            'user',
            user_id,
            feature_key=payload.feature_key,
            params=payload.params or {},
            task_id=payload.task_id,
            project_id=payload.project_id,
            metadata=payload.metadata or {},
        )
        return {"success": True, **result}
    except credit_service.InsufficientCreditsError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except credit_service.CreditServiceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("创作点数结算失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="创作点数结算失败") from exc


@router.get("/transactions")
async def list_transactions(
    user_id: str = Depends(get_current_user),
    feature_key: Optional[str] = None,
    change_type: Optional[str] = None,
    from_dt: Optional[str] = None,
    to_dt: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):

    try:
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        txns = await CreditTransactionDAO.list_for_user(
            user_id,
            feature_key=feature_key,
            change_type=change_type,
            from_dt=from_dt,
            to_dt=to_dt,
            limit=limit,
            offset=offset,
        )
        return {
            "success": True,
            "transactions": txns,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.error(f"获取创作点数流水失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

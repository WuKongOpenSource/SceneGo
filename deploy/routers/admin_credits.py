"""Shared billing administration without node, queue or deployment dependencies.

Admins can inspect accounts and make auditable adjustments. Only super-admins
may change pricing policy; existing reservations remain owned by the credit DAO.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, StrictInt, ValidationError, field_validator, model_validator

from core.db_manager import get_db_manager
from dao_credit import CreditAccountDAO, CreditRuleDAO, CreditTransactionDAO
from dao_user import UserDAO
from services import admin_audit_service, credit_service
from services.admin_access_service import load_admin_identity, require_admin_session, require_super_admin_session
from services.sensitive_data_redaction import redact_sensitive_text
from services.wechat_recharge_service import list_recharge_orders

logger = logging.getLogger(__name__)
# Keep the role gate on the shared router itself, not only on its parent.
router = APIRouter(tags=['admin-credits'], dependencies=[Depends(require_admin_session)])
_MAX_POINTS = 2**31 - 1
# Existing admin tables load 300 rows before client-side pagination. Match the
# storage cap rather than rejecting their already deployed request contract.
_MAX_PAGE_SIZE = 500


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(status_code=503, detail='Database unavailable')


async def _actor_id(username: str) -> str:
    # The dependency returns a login name. Preserve its lookup order even if
    # that name happens to equal another account's generated user ID.
    identity = await load_admin_identity(username)
    actor = str((identity or {}).get('user_id') or '')
    if not actor:
        raise HTTPException(status_code=401, detail='管理员账号已不可用')
    return actor


class CreditRuleCreateBody(BaseModel):
    feature_key: str = Field(min_length=1, max_length=100)
    feature_name: str = Field(min_length=1, max_length=255)
    base_cost: StrictInt = Field(ge=0, le=_MAX_POINTS)
    billing_unit: str = Field(default='task', min_length=1, max_length=50)
    factors: list[dict[str, Any]] = Field(default_factory=list)
    min_cost: StrictInt = Field(default=0, ge=0, le=_MAX_POINTS)
    max_cost: Optional[StrictInt] = Field(default=None, ge=0, le=_MAX_POINTS)
    enabled: bool = True
    rule_version: Optional[str] = Field(default=None, min_length=1, max_length=50)
    description: str = ''

    @field_validator('feature_key', 'feature_name', 'billing_unit', 'rule_version', mode='before')
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode='after')
    def ordered_bounds(self):
        if self.max_cost is not None and self.max_cost < self.min_cost:
            raise ValueError('最高点数不能小于最低点数')
        return self


class CreditRuleUpdateBody(BaseModel):
    feature_key: Optional[str] = None
    feature_name: Optional[str] = None
    base_cost: Optional[StrictInt] = None
    billing_unit: Optional[str] = None
    factors: Optional[list[dict[str, Any]]] = None
    min_cost: Optional[StrictInt] = None
    max_cost: Optional[StrictInt] = None
    enabled: Optional[bool] = None
    rule_version: Optional[str] = None
    description: Optional[str] = None

    @field_validator('rule_version')
    @classmethod
    def nonnull_version(cls, value):
        # Omission preserves the existing version; explicit null cannot be
        # persisted in this NOT NULL column, unlike the optional max_cost cap.
        if value is None:
            raise ValueError('规则版本不能为空')
        return value


class AdminCreditAdjustBody(BaseModel):
    delta: StrictInt = Field(ge=-_MAX_POINTS, le=_MAX_POINTS)
    reason: str = ''
    business_id: Optional[str] = None

    @field_validator('delta')
    @classmethod
    def nonzero_amount(cls, value):
        if value == 0:
            raise ValueError('调整点数不能为 0')
        return value


@router.get('/credit-rules')
async def admin_list_credit_rules():
    _require_db()
    return {'success': True, 'rules': await CreditRuleDAO.list_all()}


@router.post('/credit-rules', status_code=201, dependencies=[Depends(require_super_admin_session)])
async def admin_create_credit_rule(body: CreditRuleCreateBody, request: Request,
                                   username: str = Depends(require_admin_session)):
    _require_db()
    actor = await _actor_id(username)
    rule = await CreditRuleDAO.create(**body.model_dump())
    await admin_audit_service.record(
        request, admin_user_id=actor, action='credit_rule_create', target_type='credit_rule',
        target_id=rule['rule_id'], after=body.model_dump(),
    )
    return {'success': True, 'rule': rule}


@router.put('/credit-rules/{rule_id}', dependencies=[Depends(require_super_admin_session)])
async def admin_update_credit_rule(rule_id: str, body: CreditRuleUpdateBody, request: Request,
                                   username: str = Depends(require_admin_session)):
    _require_db()
    actor = await _actor_id(username)
    fields = body.model_dump(exclude_unset=True)
    # Validate the resulting rule, not just the patch: changing one bound must
    # respect the other persisted bound, while max_cost=null still clears a cap.
    def validate_patch(before):
        try:
            values = {key: before.get(key) for key in CreditRuleCreateBody.model_fields}
            validated = CreditRuleCreateBody.model_validate({**values, **fields}).model_dump()
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail='计费规则无效，请检查名称、非负点数及上下限') from exc
        return {key: validated[key] for key in fields}

    before, rule = await CreditRuleDAO.update_validated(rule_id, validate_patch)
    if not rule:
        raise HTTPException(status_code=404, detail='规则不存在')
    if fields:
        await admin_audit_service.record(
            request, admin_user_id=actor, action='credit_rule_update', target_type='credit_rule', target_id=rule_id,
            before=jsonable_encoder(before), after={key: rule[key] for key in fields},
        )
    return {'success': True, 'rule': rule}


@router.delete('/credit-rules/{rule_id}', dependencies=[Depends(require_super_admin_session)])
async def admin_delete_credit_rule(rule_id: str, request: Request,
                                   username: str = Depends(require_admin_session)):
    _require_db()
    actor = await _actor_id(username)
    before = await CreditRuleDAO.delete(rule_id)
    if before:
        await admin_audit_service.record(
            request, admin_user_id=actor, action='credit_rule_delete', target_type='credit_rule', target_id=rule_id,
            before=jsonable_encoder(before),
        )
    return {'success': True}


@router.get('/credit-accounts')
async def admin_list_credit_accounts(limit: int = Query(50, ge=1, le=_MAX_PAGE_SIZE), offset: int = Query(0, ge=0),
                                     search: Optional[str] = None):
    _require_db()
    rows = await CreditAccountDAO.list_all(limit=limit, offset=offset, search=search)
    return {'success': True, 'accounts': jsonable_encoder(rows)}


@router.post('/credit-accounts/{user_id}/adjust')
async def admin_credit_adjust(user_id: str, body: AdminCreditAdjustBody, request: Request,
                             username: str = Depends(require_admin_session)):
    _require_db()
    actor = await _actor_id(username)
    # Credit accounts do not have a user FK; reject unknown targets before the
    # lazy account creation can create an orphan with spendable points.
    if not await UserDAO.get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail='用户不存在')
    account = await CreditAccountDAO.get_or_create(owner_type='user', owner_id=user_id)
    try:
        result = await credit_service.admin_adjust(
            account_id=account['account_id'], amount=body.delta, reason=body.reason,
            operator=actor, feature_key=body.business_id,
        )
    except credit_service.CreditServiceError as exc:
        raise HTTPException(status_code=400, detail='无法调整创作点数，请检查账户及调整金额') from exc
    except Exception as exc:
        logger.error('Admin credit adjustment failed: %s', redact_sensitive_text(exc))
        raise HTTPException(status_code=500, detail='调整创作点数失败，请稍后重试') from exc
    await admin_audit_service.record(
        request, admin_user_id=actor, action='credit_adjust', target_type='credit_account', target_id=user_id,
        after={**body.model_dump(), 'account_id': account['account_id']}, notes=body.reason,
    )
    return {'success': True, **result}


@router.get('/credit-transactions')
async def admin_list_credit_transactions(
    user_id: Optional[str] = None, tx_type: Optional[str] = None, operated_by: Optional[str] = None,
    feature_key: Optional[str] = None, business_type: Optional[str] = None,
    limit: int = Query(100, ge=1, le=_MAX_PAGE_SIZE), offset: int = Query(0, ge=0),
):
    _require_db()
    rows = await CreditTransactionDAO.list_admin(
        user_id=user_id, tx_type=tx_type, operated_by=operated_by, feature_key=feature_key,
        business_type=business_type, limit=limit, offset=offset,
    )
    return {'success': True, 'transactions': jsonable_encoder(rows)}


@router.get('/wechat-recharge-orders')
async def admin_list_wechat_recharge_orders(
    user_id: Optional[str] = None, status: Optional[str] = None, out_trade_no: Optional[str] = None,
    limit: int = Query(100, ge=1, le=_MAX_PAGE_SIZE), offset: int = Query(0, ge=0),
):
    """Read persisted payment state; browsing the ledger never calls the provider."""
    _require_db()
    rows = await list_recharge_orders(user_id=user_id or '', status=status or '', out_trade_no=out_trade_no or '',
                                      limit=limit, offset=offset)
    return {'success': True, 'orders': jsonable_encoder(rows)}

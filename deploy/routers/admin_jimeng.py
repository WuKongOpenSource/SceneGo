"""Read-only independent account card; OAuth remains an explicit operator action."""
from fastapi import APIRouter, Depends
from services.admin_access_service import require_super_admin_session
from services.jimeng_account_service import account_status

router = APIRouter(tags=["admin-jimeng"], dependencies=[Depends(require_super_admin_session)])


@router.get("/api/admin/jimeng/status")
async def get_jimeng_status():
    result = await account_status(refresh=True)
    return {"success": True, **result, "execution_model": "seedance2.0mini",
            "pricing": "平台创作点数按 Seedance 2.0 标准模型同参数报价的一倍计费；即梦账号点数独立计算。",
            "cancel_supported": False}

"""Run role and legacy model-access behavior without importing the private router."""
from functools import partial
from types import SimpleNamespace

from admin_role_contract import AdminRoleContract
from services.admin_access_service import require_admin_access, require_super_admin_access
from services.admin_compat_service import normalize_admin_user_record


class TestSharedAdminRoleContract(AdminRoleContract):
    normalize_admin_user = staticmethod(normalize_admin_user_record)

    def bind_admin(self, monkeypatch, load_identity, validate):
        return SimpleNamespace(
            require_admin=partial(require_admin_access, identity_loader=load_identity, session_validator=validate),
            require_super_admin=partial(require_super_admin_access, identity_loader=load_identity, session_validator=validate),
        )

"""Run bootstrap configuration contracts against the public entrypoint."""
import public_main
from builtin_admin_contract import BuiltinAdminContract


class TestPublicBuiltinAdmin(BuiltinAdminContract):
    load_users = staticmethod(public_main._load_builtin_users)


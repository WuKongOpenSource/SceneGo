


import base64
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
    _HAS_FERNET = True
except ImportError:
    _HAS_FERNET = False

_FERNET_PREFIX = "fernet:"


class ApiConfigEncryptionError(RuntimeError):
    """The configured API-key encryption policy cannot be satisfied."""


def _is_production_runtime() -> bool:
    return (os.getenv("OSTORY_RUNTIME_ENV") or "development").strip().lower() == "production"


def _get_fernet(*, required: bool = False):
    """Return the configured Fernet cipher without ever logging the key value.

    Development keeps the historical Base64 fallback so contributors can run
    isolated tests without provisioning secrets. Production is fail-closed:
    storing provider credentials without real encryption is never acceptable.
    """
    key = (os.getenv("API_CONFIG_ENC_KEY") or "").strip()
    if not key or not _HAS_FERNET:
        if required:
            reason = "is missing" if not key else "requires the cryptography package"
            raise ApiConfigEncryptionError(f"API_CONFIG_ENC_KEY {reason}")
        return None
    try:
        return Fernet(key.encode())
    except Exception as exc:
        if required:
            raise ApiConfigEncryptionError("API_CONFIG_ENC_KEY is not a valid Fernet key") from exc
        logger.warning("API_CONFIG_ENC_KEY is invalid; development compatibility encoding remains active")
        return None


def validate_api_config_encryption_configuration() -> None:
    """Reject a production process that cannot encrypt provider credentials."""
    if _is_production_runtime():
        _get_fernet(required=True)


class ApiConfigDAO:
    @staticmethod
    def _encrypt_key(key: str) -> str:
        """Encrypt a provider key; production must never fall back to Base64."""
        if not key:
            return ""
        f = _get_fernet(required=_is_production_runtime())
        if f:
            return _FERNET_PREFIX + f.encrypt(key.encode()).decode()
        # Base64 is only a compatibility encoding for local development. It is
        # deliberately unreachable in production and must not be described as
        # encryption in UI or operations documentation.
        return base64.b64encode(key.encode()).decode()

    @staticmethod
    def _decrypt_key(encrypted: str) -> str:

        if not encrypted:
            return ""
        if encrypted.startswith(_FERNET_PREFIX):
            f = _get_fernet(required=_is_production_runtime())
            if not f:
                logger.error("遇到 Fernet 加密的 API key 但 API_CONFIG_ENC_KEY 未配置/无效，无法解密")
                return ""
            try:
                return f.decrypt(encrypted[len(_FERNET_PREFIX):].encode()).decode()
            except InvalidToken as exc:
                if _is_production_runtime():
                    raise ApiConfigEncryptionError("Stored API key cannot be decrypted with API_CONFIG_ENC_KEY") from exc
                logger.error("API key Fernet 解密失败（密钥不匹配？）")
                return ""
        try:
            return base64.b64decode(encrypted.encode()).decode()
        except Exception:
            return encrypted

    @staticmethod
    def decrypt_key(encrypted: str) -> str:
        """Public API for decrypting stored API keys."""
        return ApiConfigDAO._decrypt_key(encrypted)

    @staticmethod
    async def create(
        name: str,
        provider: str,
        endpoint: str,
        api_key: str,
        model_name: str = "",
        model_bindings: Optional[List[Dict[str, Any]]] = None,
        proxy_mode: str = "direct",
        request_template: Optional[dict] = None,
        headers: Optional[dict] = None,
        custom_proxy: str = "",
        category: str = "",
        enabled: bool = True,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        config_id = f"apicfg_{uuid.uuid4().hex[:12]}"
        enc = ApiConfigDAO._encrypt_key(api_key)
        rt = json.dumps(
            request_template if request_template is not None else {},
            ensure_ascii=False,
        )
        hd = json.dumps(headers if headers is not None else {}, ensure_ascii=False)
        mb = json.dumps(model_bindings if model_bindings is not None else [], ensure_ascii=False)

        query = """
            INSERT INTO api_configurations (
                config_id, name, provider, endpoint, api_key_encrypted,
                model_name, model_bindings, request_template, headers, proxy_mode, custom_proxy, category, enabled
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
            RETURNING *
        """
        return await db.fetchrow(
            query,
            config_id,
            name,
            provider,
            endpoint,
            enc,
            model_name,
            mb,
            rt,
            hd,
            proxy_mode,
            custom_proxy,
            category,
            enabled,
        )

    @staticmethod
    async def get_by_id(config_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM api_configurations WHERE config_id = $1", config_id
        )

    @staticmethod
    async def get_decrypted_key(config_id: str) -> Optional[str]:
        row = await ApiConfigDAO.get_by_id(config_id)
        if not row:
            return None
        enc = row.get("api_key_encrypted")
        if enc is None or enc == "":
            return None
        return ApiConfigDAO.decrypt_key(enc)

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM api_configurations ORDER BY name"
        )

    @staticmethod
    async def list_enabled() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM api_configurations
            WHERE enabled = TRUE
            ORDER BY name
            """
        )

    @staticmethod
    async def list_by_proxy_mode(mode: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM api_configurations
            WHERE proxy_mode = $1 AND enabled = TRUE
            ORDER BY name
            """,
            mode,
        )

    @staticmethod
    async def update(
        config_id: str, **kwargs: Any
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed_json = {"model_bindings", "request_template", "headers"}

        allowed_plain = {
            "name",
            "provider",
            "endpoint",
            "model_name",
            "proxy_mode",
            "custom_proxy",
            "enabled",
            "category",
        }
        sets: List[str] = []
        vals: List[Any] = []
        idx = 1

        if "api_key" in kwargs:
            sets.append(f"api_key_encrypted = ${idx}")
            vals.append(ApiConfigDAO._encrypt_key(kwargs["api_key"]))
            idx += 1

        for key, val in kwargs.items():
            if key == "api_key":
                continue
            if key in allowed_json:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(
                    json.dumps(val if val is not None else {}, ensure_ascii=False)
                )
                idx += 1
            elif key in allowed_plain and val is not None:
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1

        if not sets:
            return await ApiConfigDAO.get_by_id(config_id)

        vals.append(config_id)
        query = (
            f"UPDATE api_configurations SET {', '.join(sets)} "
            f"WHERE config_id = ${idx} RETURNING *"
        )
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def update_by_id(
        config_id: str, fields: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:


        return await ApiConfigDAO.update(config_id, **(fields or {}))

    @staticmethod
    async def delete(config_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM api_configurations WHERE config_id = $1", config_id
        )
        return result == "DELETE 1"

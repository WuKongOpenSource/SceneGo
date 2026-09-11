


from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


class SystemSettingsDAO:
    @staticmethod
    async def get(key: str) -> Optional[str]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "SELECT value FROM system_settings WHERE key = $1", key
        )
        if not row:
            return None
        return row["value"]

    @staticmethod
    async def set(key: str, value: str, description: str = "") -> bool:
        db = get_db_manager()
        if not db:
            return False
        await db.execute(
            """
            INSERT INTO system_settings (key, value, description)
            VALUES ($1, $2, $3)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                description = EXCLUDED.description
            """,
            key,
            value,
            description,
        )
        return True

    @staticmethod
    async def get_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM system_settings ORDER BY key"
        )

    @staticmethod
    async def get_proxy_settings() -> Dict[str, str]:
        db = get_db_manager()
        if not db:
            return {}
        rows = await db.fetch(
            """
            SELECT key, value FROM system_settings
            WHERE key LIKE 'proxy_%'
            ORDER BY key
            """
        )
        return {r["key"]: r["value"] for r in rows}

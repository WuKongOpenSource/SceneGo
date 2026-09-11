





import uuid
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _folder_id() -> str:
    return f"mlf_{uuid.uuid4().hex[:12]}"


class MediaLibraryFolderDAO:

    @staticmethod
    async def list_by_project(project_id: str, conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM media_library_folders WHERE project_id = $1 "
            "ORDER BY folder_order ASC, created_at ASC"
        )
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return []
        rows = await executor.fetch(sql, project_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def get(folder_id: str, conn=None) -> Optional[Dict[str, Any]]:
        sql = "SELECT * FROM media_library_folders WHERE folder_id = $1"
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return None
        row = await executor.fetchrow(sql, folder_id)
        return dict(row) if row else None

    @staticmethod
    async def create(
        project_id: str, name: str,
        parent_folder_id: Optional[str] = None, folder_order: int = 0, conn=None,
    ) -> Dict[str, Any]:
        fid = _folder_id()
        sql = (
            "INSERT INTO media_library_folders "
            "(folder_id, project_id, parent_folder_id, name, folder_order) "
            "VALUES ($1,$2,$3,$4,$5) RETURNING *"
        )
        executor = conn if conn is not None else get_db_manager()
        row = await executor.fetchrow(sql, fid, project_id, parent_folder_id, name, int(folder_order))
        return dict(row)

    @staticmethod
    async def update(folder_id: str, fields: Dict[str, Any], conn=None) -> Optional[Dict[str, Any]]:
        allowed = {"name", "parent_folder_id", "folder_order"}
        sets: List[str] = []
        params: List[Any] = []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        if not sets:
            return await MediaLibraryFolderDAO.get(folder_id, conn=conn)
        params.append(folder_id)
        sql = f"UPDATE media_library_folders SET {', '.join(sets)} WHERE folder_id = ${idx} RETURNING *"
        executor = conn if conn is not None else get_db_manager()
        row = await executor.fetchrow(sql, *params)
        return dict(row) if row else None

    @staticmethod
    async def delete(folder_id: str, conn=None) -> bool:
        sql = "DELETE FROM media_library_folders WHERE folder_id = $1"
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return False
        result = await executor.execute(sql, folder_id)
        try:
            return int(result.split()[-1]) > 0
        except Exception:
            return False

    @staticmethod
    async def would_create_cycle(folder_id: str, new_parent_id: Optional[str], conn=None) -> bool:

        if not new_parent_id:
            return False
        if new_parent_id == folder_id:
            return True
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return False
        current: Optional[str] = new_parent_id
        seen = set()
        while current and current not in seen:
            seen.add(current)
            if current == folder_id:
                return True
            row = await executor.fetchrow(
                "SELECT parent_folder_id FROM media_library_folders WHERE folder_id = $1", current,
            )
            if not row:
                break
            current = row["parent_folder_id"]
        return False

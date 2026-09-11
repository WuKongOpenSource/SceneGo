


import uuid
import json
from typing import Optional, List, Dict, Any
from db_manager import get_db_manager


class CanvasBoardDAO:


    @staticmethod
    async def get_episode_project_id(episode_id: str) -> Optional[str]:
        db = get_db_manager()
        value = await db.fetchval(
            "SELECT project_id FROM episodes WHERE episode_id = $1",
            episode_id,
        )
        return str(value) if value else None

    @staticmethod
    async def create_board(
        project_id: str, user_id: str,
        name: str = "未命名画布", description: str = "",
        episode_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        board_id = f"board_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO canvas_boards
                (board_id, project_id, user_id, name, description, episode_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        """
        return await db.fetchrow(
            query,
            board_id,
            project_id,
            user_id,
            name,
            description,
            episode_id,
        )

    @staticmethod
    async def get_project_boards(
        project_id: str,
        episode_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if episode_id:
            return await db.fetch(
                """
                    SELECT * FROM canvas_boards
                    WHERE project_id = $1
                      AND episode_id = $2
                      AND is_deleted = FALSE
                    ORDER BY updated_at DESC
                """,
                project_id,
                episode_id,
            )
        query = """
            SELECT * FROM canvas_boards
            WHERE project_id = $1 AND is_deleted = FALSE
            ORDER BY updated_at DESC
        """
        return await db.fetch(query, project_id)

    @staticmethod
    async def get_board(board_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetchrow(
            "SELECT * FROM canvas_boards WHERE board_id = $1 AND is_deleted = FALSE",
            board_id
        )

    @staticmethod
    async def update_board(board_id: str, **kwargs):
        db = get_db_manager()
        sets, vals = [], []
        idx = 1
        for key in ('name', 'description'):
            if key in kwargs:
                sets.append(f"{key} = ${idx}")
                vals.append(kwargs[key])
                idx += 1
        if 'viewport' in kwargs:
            sets.append(f"viewport = ${idx}::jsonb")
            vals.append(json.dumps(kwargs['viewport'], ensure_ascii=False))
            idx += 1
        if not sets:
            return
        vals.append(board_id)
        query = f"UPDATE canvas_boards SET {', '.join(sets)} WHERE board_id = ${idx}"
        await db.execute(query, *vals)

    @staticmethod
    async def delete_board(board_id: str):
        db = get_db_manager()
        await db.execute(
            "UPDATE canvas_boards SET is_deleted = TRUE WHERE board_id = $1",
            board_id
        )


class CanvasNodeDAO:


    @staticmethod
    async def create_node(
        board_id: str, node_type: str,
        x: float = 0, y: float = 0,
        width: float = 200, height: float = 150,
        data: Dict = None, z_index: int = 0
    ) -> Dict[str, Any]:
        db = get_db_manager()
        node_id = f"node_{uuid.uuid4().hex[:12]}"
        data_json = json.dumps(data or {}, ensure_ascii=False)
        query = """
            INSERT INTO canvas_nodes
                (node_id, board_id, node_type, x, y, width, height, data, z_index)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
            RETURNING *
        """
        return await db.fetchrow(
            query, node_id, board_id, node_type,
            x, y, width, height, data_json, z_index
        )

    @staticmethod
    async def get_board_nodes(board_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetch(
            "SELECT * FROM canvas_nodes WHERE board_id = $1 ORDER BY z_index",
            board_id
        )

    @staticmethod
    async def get_node(node_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetchrow(
            "SELECT * FROM canvas_nodes WHERE node_id = $1",
            node_id,
        )

    @staticmethod
    async def update_node(node_id: str, **kwargs):
        db = get_db_manager()
        sets, vals = [], []
        idx = 1
        for key in ('x', 'y', 'width', 'height', 'z_index', 'is_locked', 'node_type'):
            if key in kwargs:
                sets.append(f"{key} = ${idx}")
                vals.append(kwargs[key])
                idx += 1
        if 'data' in kwargs:
            sets.append(f"data = ${idx}::jsonb")
            vals.append(json.dumps(kwargs['data'], ensure_ascii=False))
            idx += 1
        if not sets:
            return
        vals.append(node_id)
        query = f"UPDATE canvas_nodes SET {', '.join(sets)} WHERE node_id = ${idx}"
        await db.execute(query, *vals)

    @staticmethod
    async def delete_node(node_id: str):
        db = get_db_manager()
        await db.execute("DELETE FROM canvas_nodes WHERE node_id = $1", node_id)

    @staticmethod
    async def batch_update_nodes(updates: List[Dict[str, Any]]):

        for item in updates:
            node_id = item.pop('node_id', None)
            if node_id:
                await CanvasNodeDAO.update_node(node_id, **item)


class CanvasConnectionDAO:


    @staticmethod
    async def create_connection(
        board_id: str, source_node_id: str, target_node_id: str,
        source_port: str = None, target_port: str = None, label: str = None
    ) -> Dict[str, Any]:
        db = get_db_manager()
        conn_id = f"conn_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO canvas_connections
                (connection_id, board_id, source_node_id, target_node_id,
                 source_port, target_port, label)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        """
        return await db.fetchrow(
            query, conn_id, board_id, source_node_id, target_node_id,
            source_port, target_port, label
        )

    @staticmethod
    async def get_board_connections(board_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetch(
            "SELECT * FROM canvas_connections WHERE board_id = $1",
            board_id
        )

    @staticmethod
    async def get_by_id(connection_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetchrow(
            "SELECT * FROM canvas_connections WHERE connection_id = $1",
            connection_id,
        )

    @staticmethod
    async def delete_connection(connection_id: str):
        db = get_db_manager()
        await db.execute(
            "DELETE FROM canvas_connections WHERE connection_id = $1",
            connection_id
        )

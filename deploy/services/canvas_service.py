"""Canvas board, node, and connection business logic."""
from __future__ import annotations

from typing import Any, Dict, Optional


class CanvasServiceError(RuntimeError):
    pass


class CanvasPermissionDenied(CanvasServiceError):
    pass


class CanvasBoardNotFound(CanvasServiceError):
    pass


class CanvasObjectNotFound(CanvasServiceError):
    pass


class CanvasInvalidConnection(CanvasServiceError):
    pass


class CanvasEpisodeScopeMismatch(CanvasServiceError):
    pass


async def _require_project_permission(
    project_id: str,
    user_id: str,
    required_role: str,
    *,
    project_member_dao: Any,
) -> None:
    has_permission = await project_member_dao.check_permission(project_id, user_id, required_role)
    if not has_permission:
        raise CanvasPermissionDenied(f"Project permission required: {required_role}")


async def _get_board_or_raise(board_id: str, *, canvas_board_dao: Any) -> Dict[str, Any]:
    board = await canvas_board_dao.get_board(board_id)
    if not board:
        raise CanvasBoardNotFound("Canvas board not found")
    return board


async def _get_node_or_raise(node_id: str, *, canvas_node_dao: Any) -> Dict[str, Any]:
    node = await canvas_node_dao.get_node(node_id)
    if not node:
        raise CanvasObjectNotFound("Canvas node not found")
    return node


async def _get_canvas_edge_or_raise(
    connection_id: str,
    *,
    canvas_connection_dao: Any,
) -> Dict[str, Any]:
    edge = await canvas_connection_dao.get_by_id(connection_id)
    if not edge:
        raise CanvasObjectNotFound("Canvas connection not found")
    return edge


async def _require_board_permission(
    board_id: str,
    user_id: str,
    required_role: str,
    *,
    project_member_dao: Any,
    canvas_board_dao: Any,
) -> Dict[str, Any]:
    board = await _get_board_or_raise(board_id, canvas_board_dao=canvas_board_dao)
    await _require_project_permission(
        board["project_id"],
        user_id,
        required_role,
        project_member_dao=project_member_dao,
    )
    return board


async def create_canvas_board(
    *,
    project_id: str,
    user_id: str,
    name: Optional[str],
    description: Optional[str],
    episode_id: Optional[str] = None,
    project_member_dao: Any,
    canvas_board_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(
        project_id,
        user_id,
        "member",
        project_member_dao=project_member_dao,
    )
    if episode_id:
        episode_project_id = await canvas_board_dao.get_episode_project_id(episode_id)
        if not episode_project_id or str(episode_project_id) != project_id:
            raise CanvasEpisodeScopeMismatch("Episode does not belong to the selected project")
    board = await canvas_board_dao.create_board(
        project_id,
        user_id,
        name,
        description,
        episode_id=episode_id,
    )
    return {"success": True, "board": board}


async def list_canvas_boards(
    *,
    project_id: str,
    user_id: str,
    episode_id: Optional[str] = None,
    project_member_dao: Any,
    canvas_board_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(
        project_id,
        user_id,
        "readonly",
        project_member_dao=project_member_dao,
    )
    boards = await canvas_board_dao.get_project_boards(project_id, episode_id=episode_id)
    return {"success": True, "boards": boards}


async def get_canvas_board_detail(
    *,
    board_id: str,
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
    canvas_connection_dao: Any,
) -> Dict[str, Any]:
    board = await _get_board_or_raise(board_id, canvas_board_dao=canvas_board_dao)
    await _require_project_permission(
        board["project_id"],
        user_id,
        "readonly",
        project_member_dao=project_member_dao,
    )
    nodes = await canvas_node_dao.get_board_nodes(board_id)
    connections = await canvas_connection_dao.get_board_connections(board_id)
    return {
        "success": True,
        "board": board,
        "nodes": nodes,
        "connections": connections,
    }


async def update_canvas_board(
    *,
    board_id: str,
    user_id: str,
    fields: Dict[str, Any],
    project_member_dao: Any,
    canvas_board_dao: Any,
) -> Dict[str, Any]:
    board = await _get_board_or_raise(board_id, canvas_board_dao=canvas_board_dao)
    await _require_project_permission(
        board["project_id"],
        user_id,
        "member",
        project_member_dao=project_member_dao,
    )
    await canvas_board_dao.update_board(board_id, **fields)
    return {"success": True}


async def delete_canvas_board(
    *,
    board_id: str,
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
) -> Dict[str, Any]:
    board = await _get_board_or_raise(board_id, canvas_board_dao=canvas_board_dao)
    await _require_project_permission(
        board["project_id"],
        user_id,
        "admin",
        project_member_dao=project_member_dao,
    )
    await canvas_board_dao.delete_board(board_id)
    return {"success": True}


async def create_canvas_node(
    *,
    board_id: str,
    node_type: str,
    x: Optional[float],
    y: Optional[float],
    width: Optional[float],
    height: Optional[float],
    data: Optional[dict],
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
) -> Dict[str, Any]:
    board = await _get_board_or_raise(board_id, canvas_board_dao=canvas_board_dao)
    await _require_project_permission(
        board["project_id"],
        user_id,
        "member",
        project_member_dao=project_member_dao,
    )
    node = await canvas_node_dao.create_node(board_id, node_type, x, y, width, height, data)
    return {"success": True, "node": node}


async def update_canvas_node(
    *,
    node_id: str,
    fields: Dict[str, Any],
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
) -> Dict[str, Any]:
    node = await _get_node_or_raise(node_id, canvas_node_dao=canvas_node_dao)
    await _require_board_permission(
        node["board_id"],
        user_id,
        "member",
        project_member_dao=project_member_dao,
        canvas_board_dao=canvas_board_dao,
    )
    await canvas_node_dao.update_node(node_id, **fields)
    return {"success": True}


async def delete_canvas_node(
    *,
    node_id: str,
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
) -> Dict[str, Any]:
    node = await _get_node_or_raise(node_id, canvas_node_dao=canvas_node_dao)
    await _require_board_permission(
        node["board_id"],
        user_id,
        "member",
        project_member_dao=project_member_dao,
        canvas_board_dao=canvas_board_dao,
    )
    await canvas_node_dao.delete_node(node_id)
    return {"success": True}


async def create_canvas_connection(
    *,
    board_id: str,
    source_node_id: str,
    target_node_id: str,
    source_port: Optional[str],
    target_port: Optional[str],
    label: Optional[str],
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
    canvas_connection_dao: Any,
) -> Dict[str, Any]:
    await _require_board_permission(
        board_id,
        user_id,
        "member",
        project_member_dao=project_member_dao,
        canvas_board_dao=canvas_board_dao,
    )
    source_node = await _get_node_or_raise(source_node_id, canvas_node_dao=canvas_node_dao)
    target_node = await _get_node_or_raise(target_node_id, canvas_node_dao=canvas_node_dao)
    if source_node["board_id"] != board_id or target_node["board_id"] != board_id:
        raise CanvasInvalidConnection("Connection nodes must belong to the selected board")
    canvas_link = await canvas_connection_dao.create_connection(
        board_id,
        source_node_id,
        target_node_id,
        source_port,
        target_port,
        label,
    )
    return {"success": True, "connection": canvas_link}


async def delete_canvas_connection(
    *,
    connection_id: str,
    user_id: str,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_connection_dao: Any,
) -> Dict[str, Any]:
    edge = await _get_canvas_edge_or_raise(
        connection_id,
        canvas_connection_dao=canvas_connection_dao,
    )
    await _require_board_permission(
        edge["board_id"],
        user_id,
        "member",
        project_member_dao=project_member_dao,
        canvas_board_dao=canvas_board_dao,
    )
    await canvas_connection_dao.delete_connection(connection_id)
    return {"success": True}

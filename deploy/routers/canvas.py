"""Canvas board, node, and connection route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.canvas_service import (
    CanvasBoardNotFound,
    CanvasInvalidConnection,
    CanvasEpisodeScopeMismatch,
    CanvasObjectNotFound,
    CanvasPermissionDenied,
    create_canvas_board as create_canvas_board_service,
    create_canvas_connection as create_canvas_connection_service,
    create_canvas_node as create_canvas_node_service,
    delete_canvas_board as delete_canvas_board_service,
    delete_canvas_connection as delete_canvas_connection_service,
    delete_canvas_node as delete_canvas_node_service,
    get_canvas_board_detail as get_canvas_board_detail_service,
    list_canvas_boards,
    update_canvas_board as update_canvas_board_service,
    update_canvas_node as update_canvas_node_service,
)


def create_canvas_router(
    *,
    get_current_user_dependency: Any,
    project_member_dao: Any,
    canvas_board_dao: Any,
    canvas_node_dao: Any,
    canvas_connection_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectMemberDAO = project_member_dao
    CanvasBoardDAO = canvas_board_dao
    CanvasNodeDAO = canvas_node_dao
    CanvasConnectionDAO = canvas_connection_dao

    class CanvasBoardCreate(BaseModel):
        project_id: str
        episode_id: Optional[str] = None
        name: Optional[str] = "未命名画布"
        description: Optional[str] = ""

    class CanvasNodeCreate(BaseModel):
        board_id: str
        node_type: str
        x: Optional[float] = 0
        y: Optional[float] = 0
        width: Optional[float] = 200
        height: Optional[float] = 150
        data: Optional[dict] = None

    class CanvasConnectionCreate(BaseModel):
        board_id: str
        source_node_id: str
        target_node_id: str
        source_port: Optional[str] = None
        target_port: Optional[str] = None
        label: Optional[str] = None



    @router.post("/api/canvas/boards")
    async def create_canvas_board(
        data: CanvasBoardCreate,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await create_canvas_board_service(
                project_id=data.project_id,
                user_id=user_id,
                name=data.name,
                description=data.description,
                episode_id=data.episode_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
            )
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="无权操作") from exc
        except CanvasEpisodeScopeMismatch as exc:
            raise HTTPException(status_code=404, detail="Episode not found") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/canvas/boards")
    async def get_canvas_boards(
        project_id: str,
        episode_id: Optional[str] = None,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await list_canvas_boards(
                project_id=project_id,
                user_id=user_id,
                episode_id=episode_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
            )
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="无权访问") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/canvas/boards/{board_id}")
    async def get_canvas_board_detail(
        board_id: str,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await get_canvas_board_detail_service(
                board_id=board_id,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_node_dao=CanvasNodeDAO,
                canvas_connection_dao=CanvasConnectionDAO,
            )
        except CanvasBoardNotFound as exc:
            raise HTTPException(status_code=404, detail="画布不存在") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="无权访问") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/api/canvas/boards/{board_id}")
    async def update_canvas_board(
        board_id: str,
        data: dict,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await update_canvas_board_service(
                board_id=board_id,
                user_id=user_id,
                fields=data,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
            )
        except CanvasBoardNotFound as exc:
            raise HTTPException(status_code=404, detail="画布不存在") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="无权操作") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/canvas/boards/{board_id}")
    async def delete_canvas_board(
        board_id: str,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await delete_canvas_board_service(
                board_id=board_id,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
            )
        except CanvasBoardNotFound as exc:
            raise HTTPException(status_code=404, detail="画布不存在") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="需要管理员权限") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/canvas/nodes")
    async def create_canvas_node(
        data: CanvasNodeCreate,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await create_canvas_node_service(
                board_id=data.board_id,
                node_type=data.node_type,
                x=data.x,
                y=data.y,
                width=data.width,
                height=data.height,
                data=data.data,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_node_dao=CanvasNodeDAO,
            )
        except CanvasBoardNotFound as exc:
            raise HTTPException(status_code=404, detail="画布不存在") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="无权操作") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/api/canvas/nodes/{node_id}")
    async def update_canvas_node(
        node_id: str,
        data: dict,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await update_canvas_node_service(
                node_id=node_id,
                fields=data,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_node_dao=CanvasNodeDAO,
            )
        except (CanvasBoardNotFound, CanvasObjectNotFound) as exc:
            raise HTTPException(status_code=404, detail="Canvas node not found") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="Canvas access denied") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/canvas/nodes/{node_id}")
    async def delete_canvas_node(
        node_id: str,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await delete_canvas_node_service(
                node_id=node_id,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_node_dao=CanvasNodeDAO,
            )
        except (CanvasBoardNotFound, CanvasObjectNotFound) as exc:
            raise HTTPException(status_code=404, detail="Canvas node not found") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="Canvas access denied") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/canvas/connections")
    async def create_canvas_connection(
        data: CanvasConnectionCreate,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await create_canvas_connection_service(
                board_id=data.board_id,
                source_node_id=data.source_node_id,
                target_node_id=data.target_node_id,
                source_port=data.source_port,
                target_port=data.target_port,
                label=data.label,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_node_dao=CanvasNodeDAO,
                canvas_connection_dao=CanvasConnectionDAO,
            )
        except (CanvasBoardNotFound, CanvasObjectNotFound) as exc:
            raise HTTPException(status_code=404, detail="Canvas object not found") from exc
        except CanvasInvalidConnection as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="Canvas access denied") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/canvas/connections/{connection_id}")
    async def delete_canvas_connection(
        connection_id: str,
        user_id: str = Depends(get_current_user)
    ):

        try:
            return await delete_canvas_connection_service(
                connection_id=connection_id,
                user_id=user_id,
                project_member_dao=ProjectMemberDAO,
                canvas_board_dao=CanvasBoardDAO,
                canvas_connection_dao=CanvasConnectionDAO,
            )
        except (CanvasBoardNotFound, CanvasObjectNotFound) as exc:
            raise HTTPException(status_code=404, detail="Canvas connection not found") from exc
        except CanvasPermissionDenied as exc:
            raise HTTPException(status_code=403, detail="Canvas access denied") from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    return router

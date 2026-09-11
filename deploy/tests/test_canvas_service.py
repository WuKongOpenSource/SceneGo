from __future__ import annotations

import pytest

from services import canvas_service


class FakeProjectMemberDAO:
    allowed = True
    calls = []

    @classmethod
    async def check_permission(cls, project_id, user_id, required_role="readonly"):
        cls.calls.append((project_id, user_id, required_role))
        return cls.allowed


class FakeCanvasBoardDAO:
    boards = {
        "board_1": {"board_id": "board_1", "project_id": "proj_1", "name": "画布"},
    }
    created = None
    updated = None
    deleted = []
    episode_projects = {"ep_1": "proj_1", "ep_other": "proj_2"}

    @classmethod
    async def get_episode_project_id(cls, episode_id):
        return cls.episode_projects.get(episode_id)

    @classmethod
    async def create_board(cls, project_id, user_id, name, description, episode_id=None):
        cls.created = {
            "project_id": project_id,
            "user_id": user_id,
            "name": name,
            "description": description,
            "episode_id": episode_id,
        }
        return {"board_id": "board_new", **cls.created}

    @classmethod
    async def get_project_boards(cls, project_id, episode_id=None):
        return [
            board
            for board in cls.boards.values()
            if board["project_id"] == project_id
            and (episode_id is None or board.get("episode_id") == episode_id)
        ]

    @classmethod
    async def get_board(cls, board_id):
        return cls.boards.get(board_id)

    @classmethod
    async def update_board(cls, board_id, **kwargs):
        cls.updated = {"board_id": board_id, **kwargs}

    @classmethod
    async def delete_board(cls, board_id):
        cls.deleted.append(board_id)


class FakeCanvasNodeDAO:
    nodes = {
        "node_1": {"node_id": "node_1", "board_id": "board_1"},
        "node_a": {"node_id": "node_a", "board_id": "board_1"},
        "node_b": {"node_id": "node_b", "board_id": "board_1"},
        "node_other": {"node_id": "node_other", "board_id": "board_2"},
    }
    created = None
    updated = None
    deleted = []

    @staticmethod
    async def get_board_nodes(board_id):
        return [{"node_id": "node_1", "board_id": board_id}]

    @classmethod
    async def get_node(cls, node_id):
        return cls.nodes.get(node_id)

    @classmethod
    async def create_node(cls, board_id, node_type, x, y, width, height, data):
        cls.created = {
            "board_id": board_id,
            "node_type": node_type,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "data": data,
        }
        return {"node_id": "node_new", **cls.created}

    @classmethod
    async def update_node(cls, node_id, **kwargs):
        cls.updated = {"node_id": node_id, **kwargs}

    @classmethod
    async def delete_node(cls, node_id):
        cls.deleted.append(node_id)


class FakeCanvasConnectionDAO:
    connections = {
        "conn_new": {"connection_id": "conn_new", "board_id": "board_1"},
    }
    created = None
    deleted = []

    @staticmethod
    async def get_board_connections(board_id):
        return [{"connection_id": "conn_1", "board_id": board_id}]

    @classmethod
    async def get_by_id(cls, connection_id):
        return cls.connections.get(connection_id)

    @classmethod
    async def create_connection(cls, board_id, source_node_id, target_node_id, source_port, target_port, label):
        cls.created = {
            "board_id": board_id,
            "source_node_id": source_node_id,
            "target_node_id": target_node_id,
            "source_port": source_port,
            "target_port": target_port,
            "label": label,
        }
        return {"connection_id": "conn_new", **cls.created}

    @classmethod
    async def delete_connection(cls, connection_id):
        cls.deleted.append(connection_id)


def setup_function():
    FakeProjectMemberDAO.allowed = True
    FakeProjectMemberDAO.calls = []
    FakeCanvasBoardDAO.created = None
    FakeCanvasBoardDAO.updated = None
    FakeCanvasBoardDAO.deleted = []
    FakeCanvasNodeDAO.created = None
    FakeCanvasNodeDAO.updated = None
    FakeCanvasNodeDAO.deleted = []
    FakeCanvasConnectionDAO.created = None
    FakeCanvasConnectionDAO.deleted = []


async def test_create_canvas_board_requires_member_permission():
    result = await canvas_service.create_canvas_board(
        project_id="proj_1",
        user_id="user_1",
        name="画布",
        description="说明",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
    )

    assert result["board"]["board_id"] == "board_new"
    assert FakeProjectMemberDAO.calls == [("proj_1", "user_1", "member")]
    assert FakeCanvasBoardDAO.created["episode_id"] is None


async def test_create_canvas_board_forwards_episode_scope():
    result = await canvas_service.create_canvas_board(
        project_id="proj_1",
        episode_id="ep_1",
        user_id="user_1",
        name="Studio",
        description="Episode workspace",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
    )

    assert result["board"]["episode_id"] == "ep_1"
    assert FakeCanvasBoardDAO.created["episode_id"] == "ep_1"


async def test_create_canvas_board_rejects_episode_from_another_project():
    with pytest.raises(canvas_service.CanvasEpisodeScopeMismatch):
        await canvas_service.create_canvas_board(
            project_id="proj_1",
            episode_id="ep_other",
            user_id="user_1",
            name="Studio",
            description="Episode workspace",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
        )

    assert FakeCanvasBoardDAO.created is None


async def test_list_canvas_boards_forwards_episode_scope():
    FakeCanvasBoardDAO.boards["board_ep"] = {
        "board_id": "board_ep",
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "name": "Studio",
    }
    try:
        result = await canvas_service.list_canvas_boards(
            project_id="proj_1",
            episode_id="ep_1",
            user_id="user_1",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
        )
    finally:
        FakeCanvasBoardDAO.boards.pop("board_ep", None)

    assert [board["board_id"] for board in result["boards"]] == ["board_ep"]


async def test_list_canvas_boards_raises_when_no_access():
    FakeProjectMemberDAO.allowed = False

    with pytest.raises(canvas_service.CanvasPermissionDenied):
        await canvas_service.list_canvas_boards(
            project_id="proj_1",
            user_id="user_1",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
        )


async def test_get_canvas_board_detail_loads_nodes_and_connections():
    result = await canvas_service.get_canvas_board_detail(
        board_id="board_1",
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
        canvas_node_dao=FakeCanvasNodeDAO,
        canvas_connection_dao=FakeCanvasConnectionDAO,
    )

    assert result["board"]["board_id"] == "board_1"
    assert result["nodes"] == [{"node_id": "node_1", "board_id": "board_1"}]
    assert result["connections"] == [{"connection_id": "conn_1", "board_id": "board_1"}]


async def test_get_canvas_board_detail_raises_when_missing():
    with pytest.raises(canvas_service.CanvasBoardNotFound):
        await canvas_service.get_canvas_board_detail(
            board_id="missing",
            user_id="user_1",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
            canvas_node_dao=FakeCanvasNodeDAO,
            canvas_connection_dao=FakeCanvasConnectionDAO,
        )


async def test_update_canvas_board_requires_member_permission():
    result = await canvas_service.update_canvas_board(
        board_id="board_1",
        user_id="user_1",
        fields={"name": "新名字"},
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
    )

    assert result == {"success": True}
    assert FakeCanvasBoardDAO.updated == {"board_id": "board_1", "name": "新名字"}
    assert FakeProjectMemberDAO.calls == [("proj_1", "user_1", "member")]


async def test_delete_canvas_board_requires_admin_permission():
    await canvas_service.delete_canvas_board(
        board_id="board_1",
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
    )

    assert FakeProjectMemberDAO.calls == [("proj_1", "user_1", "admin")]
    assert FakeCanvasBoardDAO.deleted == ["board_1"]


async def test_create_canvas_node_checks_board_permission():
    result = await canvas_service.create_canvas_node(
        board_id="board_1",
        node_type="asset",
        x=1,
        y=2,
        width=300,
        height=160,
        data={"asset_id": "asset_1"},
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
        canvas_node_dao=FakeCanvasNodeDAO,
    )

    assert result["node"]["node_id"] == "node_new"
    assert FakeCanvasNodeDAO.created["data"] == {"asset_id": "asset_1"}


async def test_update_canvas_node_requires_owning_board_permission():
    result = await canvas_service.update_canvas_node(
        node_id="node_1",
        fields={"x": 12, "data": {"title": "A"}},
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
        canvas_node_dao=FakeCanvasNodeDAO,
    )

    assert result == {"success": True}
    assert FakeCanvasNodeDAO.updated == {"node_id": "node_1", "x": 12, "data": {"title": "A"}}
    assert FakeProjectMemberDAO.calls == [("proj_1", "user_1", "member")]


async def test_create_and_delete_canvas_connection_delegate():
    created = await canvas_service.create_canvas_connection(
        board_id="board_1",
        source_node_id="node_a",
        target_node_id="node_b",
        source_port="out",
        target_port="in",
        label="关系",
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
        canvas_node_dao=FakeCanvasNodeDAO,
        canvas_connection_dao=FakeCanvasConnectionDAO,
    )
    deleted = await canvas_service.delete_canvas_connection(
        connection_id="conn_new",
        user_id="user_1",
        project_member_dao=FakeProjectMemberDAO,
        canvas_board_dao=FakeCanvasBoardDAO,
        canvas_connection_dao=FakeCanvasConnectionDAO,
    )

    assert created["connection"]["connection_id"] == "conn_new"
    assert deleted == {"success": True}
    assert FakeCanvasConnectionDAO.deleted == ["conn_new"]


async def test_create_canvas_connection_rejects_cross_board_nodes():
    with pytest.raises(canvas_service.CanvasInvalidConnection):
        await canvas_service.create_canvas_connection(
            board_id="board_1",
            source_node_id="node_a",
            target_node_id="node_other",
            source_port=None,
            target_port=None,
            label=None,
            user_id="user_1",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
            canvas_node_dao=FakeCanvasNodeDAO,
            canvas_connection_dao=FakeCanvasConnectionDAO,
        )


async def test_delete_canvas_node_denies_non_member():
    FakeProjectMemberDAO.allowed = False

    with pytest.raises(canvas_service.CanvasPermissionDenied):
        await canvas_service.delete_canvas_node(
            node_id="node_1",
            user_id="user_1",
            project_member_dao=FakeProjectMemberDAO,
            canvas_board_dao=FakeCanvasBoardDAO,
            canvas_node_dao=FakeCanvasNodeDAO,
        )

    assert FakeCanvasNodeDAO.deleted == []

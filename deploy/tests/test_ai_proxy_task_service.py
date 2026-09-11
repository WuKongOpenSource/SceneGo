import json

import pytest

from services.ai_proxy_task_service import (
    complete_ai_proxy_image_task,
    complete_ai_proxy_text_task,
    create_completed_gemini_text_task,
    create_completed_image_task,
    create_deepseek_text_task,
    create_minimax_text_task,
    fail_ai_proxy_task,
    format_public_text_task_name,
    start_ai_proxy_task,
)


class _Logger:
    infos = []
    errors = []
    warnings = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


class _TaskDAO:
    created = []
    updated = []
    create_error = None
    update_error = None

    @classmethod
    async def create_task(cls, **kwargs):
        if cls.create_error:
            raise cls.create_error
        cls.created.append(kwargs)

    @classmethod
    async def update_task_status(cls, **kwargs):
        if cls.update_error:
            raise cls.update_error
        cls.updated.append(kwargs)


class _NotificationDAO:
    created = []

    @classmethod
    async def create(cls, **kwargs):
        cls.created.append(kwargs)


class _Redis:
    published = []

    @classmethod
    async def publish(cls, channel, payload):
        cls.published.append((channel, payload))


@pytest.fixture(autouse=True)
def _reset_state():
    _Logger.infos = []
    _Logger.errors = []
    _Logger.warnings = []
    _TaskDAO.created = []
    _TaskDAO.updated = []
    _TaskDAO.create_error = None
    _TaskDAO.update_error = None
    _NotificationDAO.created = []
    _Redis.published = []


@pytest.mark.asyncio
async def test_create_deepseek_text_task_truncates_prompt_and_starts_task():
    task_id = await create_deepseek_text_task(
        user_id="yuan",
        prompt="x" * 600,
        response_format="json",
        temperature=0.3,
        model="deepseek-chat",
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 123,
    )

    assert task_id == "deepseek_text_123"
    assert _TaskDAO.created == [
        {
            "task_id": "deepseek_text_123",
            "user_id": "yuan",
            "task_type": "deepseek_text",
            "task_data": {
                "prompt": "x" * 500,
                "response_format": "json",
                "temperature": 0.3,
                "model": "deepseek-chat",
            },
        }
    ]
    assert _TaskDAO.updated == [
        {"task_id": "deepseek_text_123", "status": "processing"}
    ]


@pytest.mark.asyncio
async def test_create_deepseek_text_task_persists_business_context():
    await create_deepseek_text_task(
        user_id="yuan",
        prompt="prompt",
        response_format="text",
        temperature=0.2,
        model="deepseek-chat",
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 124,
        task_context={
            "operation": "storyboard_script_generate",
            "display_name": "分镜脚本生成",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "source_page": "script",
            "source_item_id": "script_1",
        },
    )

    expected_context = {
        "operation": "storyboard_script_generate",
        "display_name": "分镜脚本生成",
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "source_page": "script",
        "source_item_id": "script_1",
    }
    task_data = _TaskDAO.created[0]["task_data"]
    assert {key: task_data[key] for key in expected_context} == expected_context


@pytest.mark.asyncio
async def test_minimax_text_task_uses_own_type_and_user_scoped_notification():
    task_id = await create_minimax_text_task(
        user_id="yuan",
        prompt="prompt",
        response_format="text",
        temperature=0.2,
        model=None,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 125,
    )

    assert task_id == "minimax_text_125"
    assert _TaskDAO.created[0]["task_type"] == "minimax_text"
    assert _TaskDAO.created[0]["task_data"]["model"] == "minimax-m3"

    await complete_ai_proxy_text_task(
        task_id=task_id,
        text_content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="yuan",
        task_type="minimax_text",
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    assert _Redis.published[0][0] == "task_complete:yuan"
    assert _NotificationDAO.created[0]["title"] == "MiniMax-M3 · 连续写作模型 已完成"


@pytest.mark.asyncio
async def test_text_notification_fallback_uses_public_model_label():
    await complete_ai_proxy_text_task(
        task_id="deepseek_text_public",
        text_content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="yuan",
        task_type="deepseek_text",
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    event = json.loads(_Redis.published[0][1])
    assert event["display_name"] == "deepseek-v4-flash · 快速写作模型"
    assert _NotificationDAO.created[0]["title"] == "deepseek-v4-flash · 快速写作模型 已完成"


def test_public_text_task_name_matches_frontend_model_labels():
    assert format_public_text_task_name(
        "DeepSeek Reasoner 文本生成",
        provider="deepseek",
        model="deepseek-v4-pro",
    ) == "deepseek-v4-pro · 推理写作模型"
    assert format_public_text_task_name(
        "DeepSeek 剧本分镜",
        provider="deepseek",
    ) == "deepseek-v4-flash · 快速写作模型 剧本分镜"


@pytest.mark.asyncio
async def test_complete_ai_proxy_text_task_truncates_result():
    ok = await complete_ai_proxy_text_task(
        task_id="task_1",
        text_content="a" * 2500,
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated == [
        {
            "task_id": "task_1",
            "status": "completed",
            "result_data": {"text": "a" * 2000, "full_length": 2500},
        }
    ]


@pytest.mark.asyncio
async def test_complete_text_task_writes_notification_and_publishes_event():
    ok = await complete_ai_proxy_text_task(
        task_id="deepseek_text_1",
        text_content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="user_alpha",
        task_type="deepseek_text",
        task_context={
            "operation": "script_rewrite",
            "display_name": "剧本修改",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "source_page": "script",
            "source_item_id": "script_1",
        },
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    assert ok is True
    assert _Redis.published[0][0] == "task_complete:user_alpha"
    event = json.loads(_Redis.published[0][1])
    assert event["type"] == "task_complete"
    assert event["display_name"] == "剧本修改"
    assert event["source_page"] == "script"
    assert _NotificationDAO.created[0]["title"] == "剧本修改 已完成"
    assert _NotificationDAO.created[0]["target_project_id"] == "proj_1"
    assert _NotificationDAO.created[0]["target_item_id"] == "script_1"


@pytest.mark.asyncio
async def test_internal_text_repair_keeps_task_audit_without_user_notification():
    completed = await complete_ai_proxy_text_task(
        task_id="deepseek_text_internal",
        text_content="repaired answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="user_alpha",
        task_type="deepseek_text",
        task_context={
            "operation": "script_rewrite",
            "display_name": "视频脚本自动重规划",
            "source_page": "script",
            "suppress_notification": True,
        },
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    assert completed is True
    assert _TaskDAO.updated[-1]["status"] == "completed"
    assert _Redis.published == []
    assert _NotificationDAO.created == []

    failed = await fail_ai_proxy_task(
        task_id="deepseek_text_internal_failed",
        error_message="internal repair failed",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="user_alpha",
        task_type="deepseek_text",
        task_context={
            "operation": "script_rewrite",
            "display_name": "视频脚本自动重规划",
            "source_page": "script",
            "suppress_notification": True,
        },
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    assert failed is True
    assert _TaskDAO.updated[-1]["status"] == "failed"
    assert _Redis.published == []
    assert _NotificationDAO.created == []


@pytest.mark.asyncio
async def test_create_completed_gemini_text_task_creates_and_completes():
    task_id = await create_completed_gemini_text_task(
        user_id="yuan",
        prompt="prompt",
        system_prompt="s" * 300,
        temperature=0.7,
        model="gemini-model",
        content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 456,
    )

    assert task_id == "gemini_text_456"
    assert _TaskDAO.created[0]["task_data"] == {
        "prompt": "prompt",
        "system_prompt": "s" * 200,
        "temperature": 0.7,
        "model": "gemini-model",
    }
    assert _TaskDAO.updated == [
        {"task_id": "gemini_text_456", "status": "processing"},
        {
            "task_id": "gemini_text_456",
            "status": "completed",
            "result_data": {"text": "answer", "full_length": 6},
        },
    ]


@pytest.mark.asyncio
async def test_create_completed_image_task_creates_and_completes():
    task_id = await create_completed_image_task(
        task_id_prefix="gemini_img",
        user_id="yuan",
        task_type="gemini_image_flash",
        task_data={"prompt": "draw"},
        images_count=3,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 789,
    )

    assert task_id == "gemini_img_789"
    assert _TaskDAO.created[0]["task_type"] == "gemini_image_flash"
    assert _TaskDAO.updated == [
        {
            "task_id": "gemini_img_789",
            "status": "completed",
            "result_data": {"images_count": 3},
        }
    ]


@pytest.mark.asyncio
async def test_start_and_fail_ai_proxy_task_updates_status():
    task_id = await start_ai_proxy_task(
        task_id_prefix="doubao_img",
        user_id="yuan",
        task_type="doubao_image",
        task_data={"prompt": "draw", "entity_id": "asset_1"},
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 111,
    )

    assert task_id == "doubao_img_111"
    assert _TaskDAO.created[0]["task_id"] == "doubao_img_111"
    assert _TaskDAO.updated == [
        {"task_id": "doubao_img_111", "status": "processing"}
    ]

    ok = await fail_ai_proxy_task(
        task_id=task_id,
        error_message="upstream failed",
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated[-1] == {
        "task_id": "doubao_img_111",
        "status": "failed",
        "error_message": "upstream failed",
    }


@pytest.mark.asyncio
async def test_failed_text_task_writes_notification_and_publishes_event():
    ok = await fail_ai_proxy_task(
        task_id="gemini_text_1",
        error_message="upstream failed",
        logger=_Logger,
        task_dao=_TaskDAO,
        user_id="user_alpha",
        task_type="gemini_text",
        task_context={
            "operation": "storyboard_script_generate",
            "display_name": "分镜脚本生成",
            "source_page": "script",
        },
        redis_client=_Redis,
        notification_dao=_NotificationDAO,
    )

    assert ok is True
    assert _Redis.published[0][0] == "task_failed:user_alpha"
    event = json.loads(_Redis.published[0][1])
    assert event["status"] == "failed"
    assert event["display_name"] == "分镜脚本生成"
    assert event["error"] == "upstream failed"
    assert _NotificationDAO.created[0]["title"] == "分镜脚本生成 失败"


@pytest.mark.asyncio
async def test_complete_ai_proxy_image_task_updates_existing_task():
    ok = await complete_ai_proxy_image_task(
        task_id="gemini_img_1",
        images_count=2,
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated == [
        {
            "task_id": "gemini_img_1",
            "status": "completed",
            "result_data": {"images_count": 2},
        }
    ]


@pytest.mark.asyncio
async def test_complete_ai_proxy_image_task_persists_submitted_reference_snapshot():
    snapshot = [{"input_order": 1, "asset_id": "asset-1", "submitted": True}]
    ok = await complete_ai_proxy_image_task(
        task_id="gemini_img_refs",
        images_count=1,
        reference_snapshot=snapshot,
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is True
    assert _TaskDAO.updated == [{
        "task_id": "gemini_img_refs",
        "status": "completed",
        "result_data": {"images_count": 1, "reference_snapshot": snapshot},
    }]


@pytest.mark.asyncio
async def test_task_persistence_failures_are_nonfatal():
    _TaskDAO.create_error = RuntimeError("db down")

    task_id = await create_deepseek_text_task(
        user_id="yuan",
        prompt="prompt",
        response_format=None,
        temperature=0.1,
        logger=_Logger,
        task_dao=_TaskDAO,
        timestamp_ms_provider=lambda: 1,
    )

    assert task_id is None
    assert _Logger.errors

    _TaskDAO.create_error = None
    _TaskDAO.update_error = RuntimeError("update down")

    ok = await complete_ai_proxy_text_task(
        task_id="task_2",
        text_content="answer",
        logger=_Logger,
        task_dao=_TaskDAO,
    )

    assert ok is False

import pytest

from services.ai_proxy_image_persistence_service import persist_generated_ai_images


class _Logger:
    warnings = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_logger():
    _Logger.warnings = []


@pytest.mark.asyncio
async def test_persist_generated_ai_images_saves_and_syncs_media_library():
    save_calls = []
    file_calls = []
    media_calls = []

    def fake_content_loader(image):
        assert image == "data:image/png;base64,abc"
        return b"image-bytes"

    async def fake_save(**kwargs):
        save_calls.append(kwargs)
        return {"file_id": "file_1", "file_url": "/storage/images/file_1.png"}

    async def fake_get_file(file_id):
        file_calls.append(file_id)
        return {"file_id": file_id, "user_id": "yuan", "file_type": "image"}

    async def fake_media(**kwargs):
        media_calls.append(kwargs)

    result = await persist_generated_ai_images(
        ["data:image/png;base64,abc"],
        user_id="yuan",
        source="gemini",
        media_source="generated_image_gemini",
        prompt="draw a city",
        model="gemini-image",
        entity_type="storyboard",
        entity_id="shot_1",
        file_role=None,
        project_id="proj_1",
        episode_id="ep_1",
        file_metadata={"prompt": "draw a city", "model": "gemini-image"},
        media_metadata={"prompt": "draw a city"},
        source_task_id="task_1",
        logger=_Logger,
        image_content_loader=fake_content_loader,
        save_generated_file_to_db=fake_save,
        get_file_record=fake_get_file,
        create_media_library_item=fake_media,
    )

    assert result == [
        {
            "data_url": "data:image/png;base64,abc",
            "file_id": "file_1",
            "file_url": "/storage/images/file_1.png",
        }
    ]
    assert save_calls[0]["content"] == b"image-bytes"
    assert save_calls[0]["source"] == "gemini"
    assert save_calls[0]["file_role"] == "generated_image"
    assert save_calls[0]["episode_id"] == "ep_1"
    assert save_calls[0]["project_id"] == "proj_1"
    assert save_calls[0]["extra_metadata"] == {"prompt": "draw a city", "model": "gemini-image"}
    assert file_calls == ["file_1"]
    assert media_calls[0]["source"] == "generated_image_gemini"
    assert media_calls[0]["project_id"] == "proj_1"
    assert media_calls[0]["source_task_id"] == "task_1"
    assert media_calls[0]["source_entity_type"] == "storyboard"
    assert media_calls[0]["source_entity_id"] == "shot_1"
    assert media_calls[0]["title"] == "draw a city"
    assert media_calls[0]["metadata"] == {"prompt": "draw a city"}


@pytest.mark.asyncio
async def test_persist_generated_ai_images_preserves_remote_url_shape():
    async def fake_save(**_kwargs):
        return {"file_id": "file_url", "file_url": "/storage/images/file_url.png"}

    async def fake_get_file(_file_id):
        return None

    result = await persist_generated_ai_images(
        ["https://cdn.example.test/generated.png"],
        user_id="yuan",
        source="gpt-image-vip",
        media_source="generated_image_gpt",
        prompt="prompt",
        model="gpt-image-2-vip",
        entity_type=None,
        entity_id=None,
        file_role="cover",
        episode_id=None,
        file_metadata={"model": "gpt-image-2-vip"},
        include_url=True,
        logger=_Logger,
        image_content_loader=lambda _image: b"downloaded",
        save_generated_file_to_db=fake_save,
        get_file_record=fake_get_file,
        create_media_library_item=lambda **_kwargs: None,
    )

    assert result == [
        {
            "data_url": None,
            "url": "https://cdn.example.test/generated.png",
            "file_id": "file_url",
            "file_url": "/storage/images/file_url.png",
        }
    ]


@pytest.mark.asyncio
async def test_persist_generated_ai_images_keeps_response_when_save_or_media_fails():
    async def broken_save(**_kwargs):
        raise RuntimeError("db down")

    failed = await persist_generated_ai_images(
        ["data:image/png;base64,abc"],
        user_id="yuan",
        source="doubao",
        media_source="generated_image_doubao",
        prompt="prompt",
        model="doubao",
        entity_type=None,
        entity_id=None,
        file_role=None,
        episode_id=None,
        file_metadata={},
        logger=_Logger,
        image_content_loader=lambda _image: b"image",
        save_generated_file_to_db=broken_save,
        get_file_record=lambda _file_id: None,
        create_media_library_item=lambda **_kwargs: None,
    )

    assert failed == [{"data_url": "data:image/png;base64,abc", "file_id": None, "file_url": None}]
    assert _Logger.warnings

    async def fake_save(**_kwargs):
        return {"file_id": "file_2", "file_url": "/storage/images/file_2.png"}

    async def fake_get_file(_file_id):
        return {"file_id": "file_2"}

    async def broken_media(**_kwargs):
        raise RuntimeError("media down")

    succeeded = await persist_generated_ai_images(
        ["data:image/png;base64,abc"],
        user_id="yuan",
        source="doubao",
        media_source="generated_image_doubao",
        prompt="prompt",
        model="doubao",
        entity_type=None,
        entity_id=None,
        file_role=None,
        episode_id=None,
        file_metadata={},
        logger=_Logger,
        image_content_loader=lambda _image: b"image",
        save_generated_file_to_db=fake_save,
        get_file_record=fake_get_file,
        create_media_library_item=broken_media,
    )

    assert succeeded[0]["file_id"] == "file_2"
    assert len(_Logger.warnings) >= 2

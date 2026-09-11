import pytest

from services.audio_minimax_voice_service import (
    clone_minimax_voice_response,
    delete_minimax_voice_response,
    design_minimax_voice_response,
    get_minimax_voice_response,
    list_minimax_voices_response,
)


class _Client:
    def __init__(self):
        self.calls = []

    async def voice_design(self, **kwargs):
        self.calls.append(("voice_design", kwargs))
        return {"voice_id": "voice_design_1", "preview_audio": "/audio/preview.mp3"}

    async def voice_clone(self, **kwargs):
        self.calls.append(("voice_clone", kwargs))
        return {"voice_id": "voice_clone_1"}

    async def list_voices(self, voice_type):
        self.calls.append(("list_voices", voice_type))
        return {"voices": [{"voice_id": "voice_1"}]}

    async def get_voice(self, voice_id):
        self.calls.append(("get_voice", voice_id))
        return {"voice_id": voice_id, "name": "Demo"}

    async def delete_voice(self, voice_id, *, voice_type):
        self.calls.append(("delete_voice", {"voice_id": voice_id, "voice_type": voice_type}))
        return {"deleted": True}


@pytest.mark.asyncio
async def test_design_minimax_voice_response_forwards_payload():
    client = _Client()

    result = await design_minimax_voice_response(
        client=client,
        prompt="warm narrator",
        preview_text="hello",
        voice_id="voice_custom",
    )

    assert result == {"success": True, "voice_id": "voice_design_1", "preview_audio": "/audio/preview.mp3"}
    assert client.calls == [
        (
            "voice_design",
            {"prompt": "warm narrator", "preview_text": "hello", "voice_id": "voice_custom"},
        )
    ]


@pytest.mark.asyncio
async def test_clone_minimax_voice_response_forwards_payload():
    client = _Client()

    result = await clone_minimax_voice_response(
        client=client,
        file_id="mx_file_1",
        voice_id="voice_target",
        demo_text="sample",
        model="speech-2.8-hd",
        voice_id_prefix="clone",
    )

    assert result == {"success": True, "voice_id": "voice_clone_1"}
    assert client.calls == [
        (
            "voice_clone",
            {
                "file_id": "mx_file_1",
                "voice_id": "voice_target",
                "demo_text": "sample",
                "model": "speech-2.8-hd",
                "voice_id_prefix": "clone",
            },
        )
    ]


@pytest.mark.asyncio
async def test_list_get_delete_minimax_voice_responses_wrap_success():
    client = _Client()

    listed = await list_minimax_voices_response(client=client, voice_type="voice_cloning")
    fetched = await get_minimax_voice_response(client=client, voice_id="voice_1")
    deleted = await delete_minimax_voice_response(client=client, voice_id="voice_1", voice_type="voice_cloning")

    assert listed == {"success": True, "voices": [{"voice_id": "voice_1"}]}
    assert fetched == {"success": True, "voice_id": "voice_1", "name": "Demo"}
    assert deleted == {"success": True, "deleted": True}
    assert client.calls == [
        ("list_voices", "voice_cloning"),
        ("get_voice", "voice_1"),
        ("delete_voice", {"voice_id": "voice_1", "voice_type": "voice_cloning"}),
    ]

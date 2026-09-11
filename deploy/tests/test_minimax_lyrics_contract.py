from __future__ import annotations

import pytest

from external_api.audio.minimax_audio import MinimaxAudioClient


@pytest.mark.asyncio
async def test_lyrics_generate_uses_current_provider_payload(monkeypatch):
    client = object.__new__(MinimaxAudioClient)
    captured = {}

    async def fake_request(method, operation, **kwargs):
        captured.update({"method": method, "operation": operation, **kwargs})
        return {"lyrics": "generated"}

    monkeypatch.setattr(client, "_request_json", fake_request)

    result = await client.lyrics_generate("写一首关于夏天的歌", language="zh")

    assert result == {"lyrics": "generated"}
    assert captured["method"] == "post"
    assert captured["operation"] == "lyrics_generation"
    assert captured["json"] == {
        "mode": "write_full_song",
        "prompt": "写一首关于夏天的歌",
    }
    assert "model" not in captured["json"]
    assert "language" not in captured["json"]


@pytest.mark.asyncio
async def test_lyrics_generate_supports_current_edit_contract(monkeypatch):
    client = object.__new__(MinimaxAudioClient)
    captured = {}

    async def fake_request(method, operation, **kwargs):
        captured.update({"method": method, "operation": operation, **kwargs})
        return {"lyrics": "edited"}

    monkeypatch.setattr(client, "_request_json", fake_request)

    result = await client.lyrics_generate(
        "把副歌改得更有力量",
        mode="edit",
        lyrics="[Chorus]\n原始副歌",
        title="向前",
    )

    assert result == {"lyrics": "edited"}
    assert captured["json"] == {
        "mode": "edit",
        "prompt": "把副歌改得更有力量",
        "lyrics": "[Chorus]\n原始副歌",
        "title": "向前",
    }

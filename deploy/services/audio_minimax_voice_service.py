"""MiniMax voice management service."""
from __future__ import annotations

from typing import Any, Optional


async def design_minimax_voice_response(
    *,
    client: Any,
    prompt: str,
    preview_text: str,
    voice_id: Optional[str],
) -> dict[str, Any]:
    result = await client.voice_design(
        prompt=prompt,
        preview_text=preview_text,
        voice_id=voice_id,
    )
    return {"success": True, **result}


async def clone_minimax_voice_response(
    *,
    client: Any,
    file_id: str,
    voice_id: Optional[str],
    demo_text: Optional[str],
    model: str,
    voice_id_prefix: str,
) -> dict[str, Any]:
    result = await client.voice_clone(
        file_id=file_id,
        voice_id=voice_id,
        demo_text=demo_text,
        model=model,
        voice_id_prefix=voice_id_prefix,
    )
    return {"success": True, **result}


async def list_minimax_voices_response(*, client: Any, voice_type: str) -> dict[str, Any]:
    result = await client.list_voices(voice_type)
    return {"success": True, **result}


async def get_minimax_voice_response(*, client: Any, voice_id: str) -> dict[str, Any]:
    result = await client.get_voice(voice_id)
    return {"success": True, **result}


async def delete_minimax_voice_response(*, client: Any, voice_id: str, voice_type: str) -> dict[str, Any]:
    result = await client.delete_voice(voice_id, voice_type=voice_type)
    return {"success": True, **result}

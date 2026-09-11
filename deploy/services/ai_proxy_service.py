"""Service helpers for external AI proxy calls.

This module keeps provider resolution and HTTP request details out of route
handlers. The routers keep auth, task persistence, and response shaping.
"""
from __future__ import annotations

from services.ai_proxy_chat_service import provider_health_scope_for_failover
from services.ai_proxy_deepseek_service import (
    DEEPSEEK_SYSTEM_PROMPT,
    build_deepseek_payload,
    ensure_deepseek_configured,
    generate_deepseek_text,
    stream_deepseek_chat,
)
from services.ai_proxy_doubao_image_service import (
    build_doubao_image_payload,
    generate_doubao_images,
    parse_doubao_image_response,
)
from services.ai_proxy_gemini_text_service import (
    generate_gemini_chat_result,
    generate_gemini_text,
    generate_gemini_text_result,
    resolve_gemini_stream_config,
    stream_gemini_text,
)
from services.ai_proxy_minimax_text_service import (
    MINIMAX_M3_OPERATION,
    MINIMAX_SYSTEM_PROMPT,
    build_minimax_payload,
    ensure_minimax_configured,
    stream_minimax_chat,
)
from services.ai_proxy_gemini_image_service import (
    build_gemini_image_payload,
    generate_gemini_images,
    parse_gemini_image_response,
)

from services.ai_proxy_gpt_image_service import (
    build_gpt_image_edit_data,
    build_gpt_image_generation_payload,
    generate_gpt_images,
    normalize_gpt_image_tier,
    resolve_gpt_image_tier_config,
)
from services.ai_proxy_openai_image_service import parse_openai_image_response

"""Health-check helpers for admin API provider configurations."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlencode

import aiohttp

from services.ai_proxy_doubao_image_service import (
    normalize_doubao_standard_image_size,
    parse_doubao_image_task_response,
)
from services.ai_proxy_minimax_text_service import minimax_anthropic_messages_url
from dao.admin.system_settings import SystemSettingsDAO
from services.api_provider_endpoints import dedupe_urls, derive_models_health_urls
from services.api_provider_registry import (
    PROVIDER_CATALOG,
    doubao_image_access_mode,
    get_api_model_preset,
    get_api_provider_catalog,
    get_provider_api_path,
    get_provider_default_endpoint,
    is_google_generative_language_endpoint,
    normalize_deepseek_model_name,
    normalize_doubao_image_endpoint,
    normalize_doubao_image_model_for_endpoint,
    normalize_model_bindings,
    normalize_provider,
    normalize_seedance_endpoint,
    normalize_seedance_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider
from services.provider_endpoint_policy import (
    ProviderEndpointPolicyError,
    validate_provider_endpoint,
    validate_provider_headers,
    validate_proxy_settings,
)
from services.sensitive_data_redaction import redact_sensitive_text


ProxySettingsLoader = Callable[[], Awaitable[Dict[str, Any]]]
SessionFactory = Callable[..., Any]


class ProviderHealthNotFound(RuntimeError):
    pass


CONNECTIVITY_ONLY_STATUS = "connectivity_ok"
CONNECTIVITY_ONLY_ERROR = (
    "Metadata endpoint reachable, but generation is not verified. "
    "Run an actual generation request to confirm provider availability."
)
REAL_GENERATION_UNSUPPORTED_ERROR = (
    "This provider does not support admin real-generation test yet. "
    "Use the business workflow page to verify actual generation."
)
GENERATION_SENSITIVE_PROVIDERS = {
    "doubao",
    "gemini-text",
    "gemini-image",
    "minimax",
    "sora2",
    "veo",
    "laozhang-gpt-image",
    "laozhang-sora2",
}

TEXT_GENERATION_TEST_PROVIDERS = {"deepseek", "gemini-text"}
GEMINI_GENERATION_TEST_PROVIDERS = {"gemini-image"}
OPENAI_IMAGE_TEST_PROVIDERS = {"laozhang-gpt-image", "laozhang-sora2"}
DOUBAO_IMAGE_TEST_PROVIDERS = {"doubao"}
TASK_PENDING_STATUSES = {"queued", "pending", "running", "processing", "in_progress"}
TASK_SUCCESS_STATUSES = {"succeeded", "success", "completed", "done"}
TASK_FAILED_STATUSES = {"failed", "error", "cancelled", "canceled", "expired"}


def _jsonb_to_python(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def resolve_aiohttp_proxy(proxy_mode: str, custom_proxy: str) -> Optional[str]:
    mode, validated_proxy = validate_proxy_settings(proxy_mode, custom_proxy)
    if mode == "direct":
        return None
    if mode == "custom":
        return validated_proxy
    if mode == "system":
        return None
    return None


async def resolve_proxy_for_request(
    proxy_mode: str,
    custom_proxy: str,
    *,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
) -> Optional[str]:
    direct = resolve_aiohttp_proxy(proxy_mode, custom_proxy)
    if direct is not None or (proxy_mode or "").lower() != "system":
        return direct

    loader = proxy_settings_loader or SystemSettingsDAO.get_proxy_settings
    settings = await loader() or {}
    for key in (
        "proxy_https",
        "proxy_http",
        "https_proxy",
        "http_proxy",
        "all_proxy",
    ):
        val = settings.get(key) or settings.get(key.upper())
        if val:
            _, validated_proxy = validate_proxy_settings("custom", str(val).strip())
            return validated_proxy
    return None


def provider_catalog_item(provider: str) -> Dict[str, Any]:
    normalized = (provider or "").strip().lower()
    for item in get_api_provider_catalog():
        if (item.get("provider") or "").strip().lower() == normalized:
            return item
    return {}


def models_url_from_endpoint(endpoint: str, provider: str = "") -> List[str]:
    return derive_models_health_urls(endpoint, provider)


def api_config_health_urls(row: Dict[str, Any]) -> List[str]:
    provider = (row.get("provider") or "").strip().lower()
    model_name = (row.get("model_name") or "").strip() or None
    endpoint = (row.get("endpoint") or "").strip()
    if normalize_provider(provider) == "seedance":
        endpoint = normalize_seedance_endpoint(endpoint)
        model_name = normalize_seedance_model_for_endpoint(model_name, endpoint) or None
    preset = get_api_model_preset(provider, model_name) or {}
    catalog = provider_catalog_item(provider)

    candidates: List[str] = []
    candidates.extend(models_url_from_endpoint(endpoint, provider))
    # A configured endpoint is authoritative. Falling back to the provider
    # default can turn a failed custom/Plan credential into a false green test.
    if not endpoint:
        candidates.append(str(preset.get("health_check_url") or ""))
        candidates.append(str(catalog.get("health_check_url") or ""))
        candidates.extend(models_url_from_endpoint(str(preset.get("endpoint") or ""), provider))
    return dedupe_urls(candidates)


def uses_google_api_key_header(provider: str, endpoint: str) -> bool:
    normalized = normalize_provider(provider)
    if normalized != "gemini-image":
        return False
    return is_google_generative_language_endpoint(endpoint)


def api_health_result(
    *,
    provider: str,
    model_name: str,
    ok: bool,
    reachable: bool,
    auth_ok: bool,
    status_code: Optional[int],
    url: Optional[str],
    error: Optional[str],
    urls_tried: List[str],
    status: Optional[str] = None,
) -> Dict[str, Any]:
    result_status = status or ("ok" if ok else "error")
    if error == "No API key configured":
        result_status = "no_key"
    return {
        "success": True,
        "test": {
            "ok": ok,
            "status": result_status,
            "reachable": reachable,
            "auth_ok": auth_ok,
            "status_code": status_code,
            "url": url,
            "error": error,
            "provider": provider or None,
            "model_name": model_name or None,
            "method": "GET",
            "urls_tried": urls_tried,
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        },
    }


def api_real_generation_result(
    *,
    provider: str,
    model_name: str,
    ok: bool,
    status_code: Optional[int],
    url: Optional[str],
    error: Optional[str],
    latency_ms: Optional[int],
    output_type: Optional[str],
    status: Optional[str] = None,
) -> Dict[str, Any]:
    if status:
        result_status = status
    elif ok:
        result_status = "generation_ok"
    elif error == "No API key configured":
        result_status = "no_key"
    else:
        result_status = "error"
    return {
        "success": True,
        "test": {
            "ok": ok,
            "status": result_status,
            "reachable": status_code is not None,
            "auth_ok": status_code not in (401, 403) if status_code is not None else False,
            "status_code": status_code,
            "url": url,
            "error": error,
            "provider": provider or None,
            "model_name": model_name or None,
            "method": "POST",
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "real_generation": True,
            "billable": True,
            "latency_ms": latency_ms,
            "output_type": output_type,
        },
    }


def is_generation_sensitive_provider(provider: str) -> bool:
    return normalize_provider(provider) in GENERATION_SENSITIVE_PROVIDERS


def _join_api_url(endpoint: str, path: str = "") -> str:
    base = (endpoint or "").strip().rstrip("/")
    suffix = (path or "").strip("/")
    if not suffix:
        return base
    if base.endswith(f"/{suffix}"):
        return base
    return f"{base}/{suffix}"


def _headers_for_generation(provider: str, endpoint: str, api_key: str, extra_headers: Any = None) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    raw = _jsonb_to_python(extra_headers) or {}
    headers.update(validate_provider_headers(raw))
    headers.setdefault("Content-Type", "application/json")
    normalized = normalize_provider(provider)
    if normalized == "minimax" and "/anthropic/" in endpoint.lower():
        for key in list(headers.keys()):
            if key.lower() in {"authorization", "x-api-key", "anthropic-version"}:
                del headers[key]
        headers["X-Api-Key"] = api_key
        headers["Anthropic-Version"] = "2023-06-01"
    elif uses_google_api_key_header(provider, endpoint):
        headers["x-goog-api-key"] = api_key
    else:
        for key in list(headers.keys()):
            if key.lower() == "authorization":
                del headers[key]
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _has_gemini_inline_data(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    for candidate in payload.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if isinstance(part, dict) and part.get("inlineData"):
                return True
    return False


def _has_openai_image_data(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    data = payload.get("data")
    return isinstance(data, list) and len(data) > 0


def _task_id_from_payload(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for key in ("id", "task_id"):
        value = payload.get(key)
        if value:
            return str(value)
    for key in ("data", "output", "result"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            task_id = _task_id_from_payload(nested)
            if task_id:
                return task_id
    return None


def _task_status_from_payload(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("status", "task_status"):
        value = payload.get(key)
        if value:
            return str(value).strip().lower()
    for key in ("data", "output", "result"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            status = _task_status_from_payload(nested)
            if status:
                return status
    return ""


def _task_error_from_payload(payload: Any) -> str:
    if not isinstance(payload, dict):
        return redact_sensitive_text(payload, max_chars=500)
    for key in ("error", "message", "status_message", "task_status_msg"):
        value = payload.get(key)
        if value:
            return str(value)
    for key in ("data", "output", "result"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            error = _task_error_from_payload(nested)
            if error:
                return error
    return redact_sensitive_text(payload, max_chars=500)


def _has_chat_content(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return False
    message = (choices[0] or {}).get("message") or {}
    return bool(message.get("content") or message.get("reasoning_content"))


def _has_anthropic_text_content(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    content = payload.get("content")
    if not isinstance(content, list):
        return False
    return any(
        isinstance(block, dict)
        and block.get("type") == "text"
        and bool(block.get("text"))
        for block in content
    )


def _has_minimax_audio_data(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    base_resp = payload.get("base_resp") or {}
    if isinstance(base_resp, dict) and str(base_resp.get("status_code", 0)) != "0":
        return False
    data = payload.get("data") or {}
    return isinstance(data, dict) and bool(data.get("audio"))


def _has_minimax_task_id(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    base_resp = payload.get("base_resp") or {}
    if isinstance(base_resp, dict) and str(base_resp.get("status_code", 0)) != "0":
        return False
    return bool(_task_id_from_payload(payload))


def _minimax_response_hint(payload: Dict[str, Any]) -> Optional[str]:
    data = payload.get("data")
    if isinstance(data, dict):
        status = data.get("status")
        if status is not None:
            trace_id = payload.get("trace_id")
            suffix = f"; trace_id={trace_id}" if trace_id else ""
            return f"MiniMax response did not include expected output: data.status={status}{suffix}"
    for key in ("message", "msg", "error_message", "status_msg"):
        value = payload.get(key)
        if value:
            return f"MiniMax message: {value}"
    return None


def _minimax_error_from_payload(payload: Any, output_type: Optional[str] = None) -> Optional[str]:
    if not isinstance(payload, dict):
        return None

    base_resp = payload.get("base_resp") or {}
    if isinstance(base_resp, dict):
        code = base_resp.get("status_code")
        msg = base_resp.get("status_msg")
        if code not in (None, 0, "0"):
            parts = [f"MiniMax status_code={code}"]
            if msg:
                parts.append(f"status_msg={msg}")
            trace_id = payload.get("trace_id")
            if trace_id:
                parts.append(f"trace_id={trace_id}")
            if str(code) == "1004":
                parts.append(
                    "Hint: for Token Plan, paste the full Subscription Key from Billing > Token Plan; "
                    "Subscription Keys and pay-as-you-go API keys are not interchangeable."
                )
            if str(code) == "2056" and output_type == "video_task":
                parts.append(
                    "Hint: Token Plan Plus does not include MiniMax video generation; "
                    "use Token Plan Max/Ultra or a pay-as-you-go/points key for Hailuo video."
                )
            return "; ".join(parts)

    code = payload.get("status_code") or payload.get("code") or payload.get("err_code")
    msg = payload.get("status_msg") or payload.get("message") or payload.get("msg") or payload.get("error_message")
    if code and str(code) not in {"0", "success"}:
        return f"MiniMax status_code={code}" + (f"; status_msg={msg}" if msg else "")
    if msg and str(msg).lower() not in {"success", "ok"}:
        return f"MiniMax message: {msg}"

    error = payload.get("error")
    if isinstance(error, dict):
        msg = error.get("message") or error.get("type")
        if msg:
            code = error.get("http_code") or error.get("code")
            prefix = f"MiniMax error {code}" if code else "MiniMax error"
            return f"{prefix}: {msg}"
    elif error:
        return f"MiniMax error: {error}"
    return _minimax_response_hint(payload)


def _real_generation_error(provider: str, output_type: str, payload: Any) -> Optional[str]:
    if normalize_provider(provider) == "minimax":
        return _minimax_error_from_payload(payload, output_type)
    return None


def _api_binding_category(binding: Dict[str, Any], provider: str = "") -> str:
    haystack = " ".join(
        str(binding.get(key) or "").strip().lower()
        for key in ("operation", "label", "model_name")
    )
    if any(token in haystack for token in ("tts", "speech", "voice", "audio", "music", "语音", "声音", "配音", "音频", "音乐")):
        return "audio"
    if any(token in haystack for token in ("video", "hailuo", "seedance", "sora", "veo", "wan", "kling", "vidu", "happyhorse", "视频", "图生视频", "首尾帧")):
        return "video"
    if any(token in haystack for token in ("image", "seedream", "picture", "photo", "图像", "图片", "生图")):
        return "image"
    if any(token in haystack for token in ("text", "chat", "reason", "language", "minimax-m3", "文本", "推理", "对话")):
        return "text"

    provider_id = normalize_provider(provider)
    if "tts" in provider_id:
        return "audio"
    if provider_id in {"seedance", "sora2", "veo", "dashscope"}:
        return "video"
    if "image" in provider_id or provider_id == "doubao":
        return "image"
    return ""


def _model_for_generation_category(row: Dict[str, Any], provider: str, category: str) -> str:
    normalized_category = (category or "").strip().lower()
    if normalized_category not in {"text", "image", "video", "audio"}:
        return str(row.get("model_name") or "").strip()
    bindings = normalize_model_bindings(
        provider,
        _jsonb_to_python(row.get("model_bindings")) or [],
        str(row.get("model_name") or "").strip(),
    )
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        if _api_binding_category(binding, provider) == normalized_category:
            model_name = str(binding.get("model_name") or "").strip()
            if model_name:
                return model_name
    return str(row.get("model_name") or "").strip()


def _apply_generation_category_hint(row: Dict[str, Any]) -> Dict[str, Any]:
    category = str(row.get("_test_category") or row.get("category") or "").strip().lower()
    provider = str(row.get("provider") or "")
    if not category and normalize_provider(provider) == "minimax":
        bindings = _jsonb_to_python(row.get("model_bindings")) or []
        if isinstance(bindings, list) and any(
            isinstance(binding, dict)
            and _api_binding_category(binding, provider) == "text"
            for binding in bindings
        ):
            # MiniMax cards commonly keep the Hailuo video model as their
            # primary row model. The admin real-generation probe is a text
            # chat request, so an omitted UI category must never send Hailuo
            # to /chat/completions when a text binding exists on the card.
            category = "text"
    if not category:
        return row
    model_name = _model_for_generation_category(row, provider, category)
    if model_name:
        next_row = dict(row)
        next_row["model_name"] = model_name
        next_row["_test_category"] = category
        return next_row
    return row


def _minimax_request_template(row: Dict[str, Any]) -> Dict[str, Any]:
    raw = _jsonb_to_python(row.get("request_template")) or {}
    if not isinstance(raw, dict):
        return {}
    return raw


def _minimax_access_mode(row: Dict[str, Any]) -> str:
    return str(_minimax_request_template(row).get("provider_access_mode") or "").strip().lower()


def _minimax_is_token_plan(row: Dict[str, Any]) -> bool:
    access_mode = _minimax_access_mode(row)
    return "token_plan" in access_mode or "tokenplan" in access_mode


def _minimax_group_id(row: Dict[str, Any]) -> str:
    if _minimax_is_token_plan(row):
        return ""
    raw = _minimax_request_template(row)
    for key in ("group_id", "minimax_group_id", "GroupId"):
        value = str(raw.get(key) or "").strip()
        if value:
            return value
    return ""


def _append_query_param(url: str, params: Dict[str, str]) -> str:
    clean_params = {key: value for key, value in params.items() if value}
    if not clean_params:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode(clean_params)}"


def _real_generation_request(provider: str, row: Dict[str, Any]) -> tuple[str, Dict[str, Any], str]:
    generation_row = dict(row)
    generation_row.setdefault("provider", provider)
    row = _apply_generation_category_hint(generation_row)
    normalized = normalize_provider(provider)
    endpoint = str(row.get("endpoint") or "").strip()
    model_name = str(row.get("model_name") or "").strip()
    preset = get_api_model_preset(normalized, model_name) or {}
    model = model_name or str(preset.get("model_name") or "").strip()
    category = str(row.get("_test_category") or row.get("category") or "").strip().lower()

    if normalized in TEXT_GENERATION_TEST_PROVIDERS or (
        normalized == "minimax" and category == "text"
    ):
        requested_model = model or (
            "deepseek-reasoner"
            if normalized == "deepseek"
            else "MiniMax-M3"
            if normalized == "minimax"
            else "gemini-2.5-flash"
        )
        resolved_model = (
            normalize_deepseek_model_name(requested_model)
            if normalized == "deepseek"
            else requested_model
        )
        if normalized == "minimax":
            return minimax_anthropic_messages_url(endpoint), {
                "model": resolved_model,
                "max_tokens": 32,
                "messages": [{"role": "user", "content": "Please reply with the word OK only."}],
                "temperature": 0,
                "stream": False,
                "thinking": {"type": "disabled"},
            }, "text"

        url = _join_api_url(endpoint, get_provider_api_path(normalized, "chat_completions"))
        payload = {
            "model": resolved_model,
            "messages": [{"role": "user", "content": "Please reply with the word OK only."}],
            "temperature": 0,
            "stream": False,
        }
        if normalized == "deepseek":
            # Reasoning models can spend the first tokens on reasoning_content
            # before producing their final content field.
            payload["max_tokens"] = 64 if resolved_model == "deepseek-v4-pro" else 32
            payload["thinking"] = {
                "type": "enabled" if resolved_model == "deepseek-v4-pro" else "disabled"
            }
        else:
            payload["max_tokens"] = 32
        return url, payload, "text"

    if normalized == "gemini-image":
        model = model or "gemini-2.5-flash-image"
        url = _join_api_url(endpoint, get_provider_api_path(normalized, "generate_content", model=model))
        image_config: Dict[str, Any] = {"aspectRatio": "1:1"}
        if model.startswith("gemini-3.1-flash-image"):
            image_config["imageSize"] = "512"
        return url, {
            "contents": [{"parts": [{"text": "Generate a very simple 1:1 blue square icon."}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": image_config,
            },
        }, "image"

    if normalized == "minimax":
        if category == "video":
            raise ProviderHealthNotFound(REAL_GENERATION_UNSUPPORTED_ERROR)
        if category != "audio":
            raise ProviderHealthNotFound(REAL_GENERATION_UNSUPPORTED_ERROR)
        model = model if model.lower().startswith("speech-") else "speech-2.8-hd"
        url = _join_api_url(endpoint, get_provider_api_path(normalized, "tts_sync"))
        url = _append_query_param(url, {"GroupId": _minimax_group_id(row)})
        return url, {
            "model": model,
            "text": "OK.",
            "stream": False,
            "voice_setting": {
                "voice_id": "male-qn-qingse",
                "speed": 1.0,
                "vol": 1.0,
                "pitch": 0,
            },
            "audio_setting": {
                "format": "mp3",
                "sample_rate": 32000,
                "bitrate": 128000,
                "channel": 1,
            },
            "subtitle_enable": False,
        }, "audio"

    if normalized in DOUBAO_IMAGE_TEST_PROVIDERS:
        model = normalize_doubao_image_model_for_endpoint(model, endpoint)
        url = normalize_doubao_image_endpoint(endpoint)
        is_agent_plan = doubao_image_access_mode(endpoint) == "agent_plan"
        # Agent Plan requires a 2K square. The current pay-as-you-go SeedDream
        # models require at least 3,686,400 pixels even for a lightweight test.
        size = (
            "2048x2048"
            if is_agent_plan
            else normalize_doubao_standard_image_size("1024x1024")
        )
        payload = {
            "model": model,
            "prompt": "A simple blue square icon on a white background.",
            "size": size,
            "response_format": "url",
            "watermark": False,
        }
        return url, payload, "image"

    if normalized in OPENAI_IMAGE_TEST_PROVIDERS:
        url = _join_api_url(endpoint, get_provider_api_path(normalized, "image_generations"))
        return url, {
            "model": model or "gpt-image-2",
            "prompt": "A simple blue square icon on a white background.",
            "n": 1,
            "size": "1024x1024",
            "quality": "low",
        }, "image"

    # Video providers intentionally remain unsupported here. A generic video
    # probe could create a costly task with the wrong duration or resolution.
    raise ProviderHealthNotFound(REAL_GENERATION_UNSUPPORTED_ERROR)


def _real_generation_response_ok(output_type: str, payload: Any) -> bool:
    if output_type == "text":
        return _has_chat_content(payload) or _has_anthropic_text_content(payload)
    if output_type == "audio":
        return _has_gemini_inline_data(payload) or _has_minimax_audio_data(payload)
    if output_type == "image":
        return _has_gemini_inline_data(payload) or _has_openai_image_data(payload)
    if output_type == "image_task":
        return bool(parse_doubao_image_task_response(payload if isinstance(payload, dict) else {}))
    return False


async def _poll_real_generation_task(
    *,
    session: Any,
    url: str,
    headers: Dict[str, str],
    proxy: Optional[str],
    task_id: str,
    max_wait: int = 180,
    interval: float = 3.0,
) -> tuple[bool, Optional[int], Optional[str]]:
    task_url = f"{url.rstrip('/')}/{task_id}"
    deadline = time.perf_counter() + max_wait
    last_payload: Any = None
    last_status_code: Optional[int] = None
    validate_provider_endpoint(task_url)

    while time.perf_counter() < deadline:
        async with session.get(task_url, headers=headers, proxy=proxy, allow_redirects=False) as resp:
            last_status_code = resp.status
            text = await resp.text()
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                payload = None
            last_payload = payload
            if resp.status >= 400:
                return False, resp.status, redact_sensitive_text(
                    text or f"HTTP {resp.status}", max_chars=500
                )
            if _real_generation_response_ok("image_task", payload):
                return True, resp.status, None
            status = _task_status_from_payload(payload)
            if status in TASK_FAILED_STATUSES:
                return False, resp.status, _task_error_from_payload(payload)
            if status in TASK_SUCCESS_STATUSES:
                return False, resp.status, "Generation task succeeded but no image output was returned"
        await asyncio.sleep(interval)

    return (
        False,
        last_status_code,
        f"Generation task timeout: task_id={task_id}, status={_task_status_from_payload(last_payload) or 'unknown'}",
    )


async def test_api_config_real_generation(
    row: Dict[str, Any],
    api_key: str,
    *,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
    session_factory: Optional[SessionFactory] = None,
) -> Dict[str, Any]:
    row = _apply_generation_category_hint(dict(row))
    provider = str(row.get("provider") or "")
    normalized = normalize_provider(provider)
    model_name = str(row.get("model_name") or "")
    endpoint = str(row.get("endpoint") or "").strip()

    if not api_key:
        return api_real_generation_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            status_code=None,
            url=None,
            error="No API key configured",
            latency_ms=None,
            output_type=None,
        )
    try:
        validate_provider_endpoint(endpoint)
    except ProviderEndpointPolicyError as exc:
        return api_real_generation_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            status_code=None,
            url=None,
            error=redact_sensitive_text(exc, max_chars=500),
            latency_ms=None,
            output_type=None,
        )
    if not endpoint:
        return api_real_generation_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            status_code=None,
            url=None,
            error="Endpoint is not configured",
            latency_ms=None,
            output_type=None,
        )

    try:
        url, body, output_type = _real_generation_request(normalized, row)
    except ProviderHealthNotFound:
        return api_real_generation_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            status_code=None,
            url=None,
            error=REAL_GENERATION_UNSUPPORTED_ERROR,
            latency_ms=None,
            output_type=None,
            status="unsupported",
        )
    effective_model_name = str(body.get("model") or model_name) if isinstance(body, dict) else model_name

    headers = _headers_for_generation(normalized, url, api_key, row.get("headers"))
    proxy = await resolve_proxy_for_request(
        str(row.get("proxy_mode") or "direct"),
        str(row.get("custom_proxy") or ""),
        proxy_settings_loader=proxy_settings_loader,
    )
    timeout = aiohttp.ClientTimeout(total=180)
    factory = session_factory or aiohttp.ClientSession
    t0 = time.perf_counter()
    try:
        async with factory(timeout=timeout) as session:
            validate_provider_endpoint(url)
            async with session.post(url, headers=headers, json=body, proxy=proxy, allow_redirects=False) as resp:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                text = await resp.text()
                payload: Any = None
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    payload = None
                if resp.status >= 400:
                    return api_real_generation_result(
                        provider=provider,
                        model_name=effective_model_name,
                        ok=False,
                        status_code=resp.status,
                        url=url,
                        error=redact_sensitive_text(
                            text or f"HTTP {resp.status}", max_chars=500
                        ),
                        latency_ms=latency_ms,
                        output_type=output_type,
                    )
                ok = _real_generation_response_ok(output_type, payload)
                error = None if ok else (
                    _real_generation_error(normalized, output_type, payload)
                    or "Generation response did not contain expected output"
                )
                status_code: Optional[int] = resp.status
                if not ok and output_type == "image_task":
                    task_id = _task_id_from_payload(payload)
                    if task_id:
                        ok, poll_status_code, poll_error = await _poll_real_generation_task(
                            session=session,
                            url=url,
                            headers=headers,
                            proxy=proxy,
                            task_id=task_id,
                        )
                        status_code = poll_status_code or status_code
                        error = poll_error
                        latency_ms = int((time.perf_counter() - t0) * 1000)
                return api_real_generation_result(
                    provider=provider,
                    model_name=effective_model_name,
                    ok=ok,
                    status_code=status_code,
                    url=url,
                    error=error,
                    latency_ms=latency_ms,
                    output_type=output_type,
                )
    except Exception as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return api_real_generation_result(
            provider=provider,
            model_name=effective_model_name,
            ok=False,
            status_code=None,
            url=url,
            error=redact_sensitive_text(exc, max_chars=500),
            latency_ms=latency_ms,
            output_type=output_type,
        )


async def test_api_config_health(
    row: Dict[str, Any],
    api_key: str,
    *,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
    session_factory: Optional[SessionFactory] = None,
) -> Dict[str, Any]:
    provider = str(row.get("provider") or "")
    model_name = str(row.get("model_name") or "")
    urls_to_try = api_config_health_urls(row)

    if not api_key:
        return api_health_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            reachable=False,
            auth_ok=False,
            status_code=None,
            url=None,
            error="No API key configured",
            urls_tried=urls_to_try,
        )

    try:
        for candidate in urls_to_try:
            if candidate:
                validate_provider_endpoint(candidate)
    except ProviderEndpointPolicyError as exc:
        return api_health_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            reachable=False,
            auth_ok=False,
            status_code=None,
            url=None,
            error=redact_sensitive_text(exc, max_chars=500),
            urls_tried=urls_to_try,
        )

    hdrs_raw = _jsonb_to_python(row.get("headers")) or {}
    headers: Dict[str, str] = {}
    if isinstance(hdrs_raw, dict):
        headers = validate_provider_headers(hdrs_raw)
    if "Authorization" not in headers and "authorization" not in headers:
        headers["Authorization"] = f"Bearer {api_key}"

    proxy = await resolve_proxy_for_request(
        str(row.get("proxy_mode") or "direct"),
        str(row.get("custom_proxy") or ""),
        proxy_settings_loader=proxy_settings_loader,
    )
    timeout = aiohttp.ClientTimeout(total=20)
    last_error: Optional[str] = None
    last_status: Optional[int] = None
    tried_url: Optional[str] = None
    reachable = False
    auth_ok = False

    factory = session_factory or aiohttp.ClientSession
    try:
        async with factory(timeout=timeout) as session:
            for url in urls_to_try:
                if not url:
                    continue
                tried_url = url
                try:
                    async with session.get(
                        url, headers=headers, proxy=proxy, allow_redirects=False
                    ) as resp:
                        last_status = resp.status
                        reachable = resp.status < 500
                        auth_ok = resp.status not in (401, 403)
                        if 200 <= resp.status < 300:
                            ok = True
                            error = None
                            status = "ok"
                            if is_generation_sensitive_provider(provider):
                                ok = False
                                status = CONNECTIVITY_ONLY_STATUS
                                error = CONNECTIVITY_ONLY_ERROR
                            return api_health_result(
                                provider=provider,
                                model_name=model_name,
                                ok=ok,
                                reachable=True,
                                auth_ok=True,
                                status_code=resp.status,
                                url=url,
                                error=error,
                                urls_tried=urls_to_try,
                                status=status,
                            )
                        body = redact_sensitive_text(await resp.text(), max_chars=300)
                        if resp.status in (401, 403):
                            last_error = f"Authentication failed (HTTP {resp.status})"
                        else:
                            last_error = f"HTTP {resp.status}"
                        if body:
                            last_error = f"{last_error}: {body}"
                except aiohttp.ClientError as e:
                    last_error = redact_sensitive_text(e, max_chars=300)
    except Exception as e:
        return api_health_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            reachable=reachable,
            auth_ok=auth_ok,
            status_code=last_status,
            url=tried_url,
            error=redact_sensitive_text(e, max_chars=500),
            urls_tried=urls_to_try,
        )

    return api_health_result(
        provider=provider,
        model_name=model_name,
        ok=False,
        reachable=reachable,
        auth_ok=auth_ok,
        status_code=last_status,
        url=tried_url,
        error=last_error or "Request failed",
        urls_tried=urls_to_try,
    )


async def check_provider_health(
    provider_id: str,
    *,
    model_name: Optional[str] = None,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
    session_factory: Optional[SessionFactory] = None,
) -> Dict[str, Any]:
    """Health-check the effective runtime config for a provider.

    Unlike test_api_config_health(), this uses resolve_provider(), so it proves
    the hot-reloaded DB/env state that real generation calls will see.
    """
    provider = normalize_provider(provider_id)
    if provider not in PROVIDER_CATALOG:
        raise ProviderHealthNotFound(f"Unknown provider: {provider_id}")

    # A provider-level check must follow the runtime-effective model. Picking
    # the first preset here can silently probe a disabled/legacy model.
    resolved_model = str(model_name or "").strip() or None
    config = resolve_provider(provider, resolved_model)
    row = {
        "provider": provider,
        "model_name": config.model_name or resolved_model or "",
        "endpoint": config.endpoint,
        "proxy_mode": config.proxy_config.get("mode") or "direct",
        "custom_proxy": config.proxy_config.get("custom_proxy") or "",
        "headers": {},
    }
    urls_to_try = api_config_health_urls(row)
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    if not config.has_key:
        return {
            "success": True,
            "provider": provider,
            "model_name": row["model_name"] or None,
            "status": "no_key",
            "latency_ms": None,
            "checked_at": checked_at,
            "health": {
                "ok": False,
                "reachable": False,
                "auth_ok": False,
                "status_code": None,
                "url": None,
                "error": "No API key configured",
                "method": "GET",
                "urls_tried": urls_to_try,
            },
        }

    t0 = time.perf_counter()
    result = await test_api_config_health(
        row,
        config.api_key,
        proxy_settings_loader=proxy_settings_loader,
        session_factory=session_factory,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    test = result.get("test") or {}
    ok = bool(test.get("ok"))
    status = str(test.get("status") or ("ok" if ok else "error"))
    if is_generation_sensitive_provider(provider) and test.get("reachable") and test.get("auth_ok"):
        status = "connectivity_ok"
    return {
        "success": True,
        "provider": provider,
        "model_name": row["model_name"] or None,
        "status": status,
        "latency_ms": latency_ms,
        "checked_at": test.get("checked_at") or checked_at,
        "health": {
            "ok": ok,
            "reachable": bool(test.get("reachable")),
            "auth_ok": bool(test.get("auth_ok")),
            "status_code": test.get("status_code"),
            "url": test.get("url"),
            "error": test.get("error"),
            "method": test.get("method") or "GET",
            "urls_tried": test.get("urls_tried") or urls_to_try,
        },
    }

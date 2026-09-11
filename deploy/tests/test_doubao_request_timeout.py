import asyncio
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import requests

from services import ai_proxy_doubao_image_service as doubao
from services import ai_proxy_http_client as http_client
from services.ai_proxy_types import AIProxyUpstreamError
from services.api_provider_registry import (
    DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
    DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    DOUBAO_IMAGE_PAYG_MODEL,
    DOUBAO_IMAGE_STANDARD_ENDPOINT,
)


def config_for(endpoint, model):
    return SimpleNamespace(
        api_key="test-key", endpoint=endpoint, model_name=model,
        url_for=lambda: endpoint, requests_kwargs=lambda: {},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint,model,read_timeout", [
    (DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT, DOUBAO_IMAGE_AGENT_PLAN_MODEL, 600),
    (DOUBAO_IMAGE_STANDARD_ENDPOINT, DOUBAO_IMAGE_PAYG_MODEL, 120),
])
async def test_image_upload_and_generation_use_separate_safe_timeouts(monkeypatch, endpoint, model, read_timeout):
    post = AsyncMock(return_value={"data": [{"url": "https://cdn.example.test/original.jpg"}]})
    monkeypatch.setattr(doubao, "_post_json_request_async", post)
    images = await doubao._post_doubao_image_generation(
        config=config_for(endpoint, model), payload={"model": model, "size": "2k", "prompt": "test"},
    )
    assert images == ["https://cdn.example.test/original.jpg"]
    assert post.await_count == 1
    assert post.call_args.kwargs["timeout"] == (60, read_timeout)
    assert post.call_args.kwargs["timeout_status_code"] == 504
    assert post.call_args.kwargs["upload_timeout"] == 180


def test_chunked_writes_preserve_json_bytes_content_length_and_original_references(monkeypatch):
    payload = {"prompt": "原图", "image": "data:image/png;base64," + "abcd" * 100_000}
    expected = json.dumps(payload, allow_nan=False).encode("utf-8")
    captured = {}

    def post(url, *, headers, data, **kwargs):
        prepared = requests.Request("POST", url, headers=headers, data=data).prepare()
        assert prepared.headers["Content-Type"] == "application/json"
        assert prepared.headers["Content-Length"] == str(len(expected))
        assert "Transfer-Encoding" not in prepared.headers
        chunks = list(iter(lambda: data.read(128 * 1024), b""))
        assert len(chunks) > 1
        assert max(map(len, chunks)) <= 64 * 1024
        assert hashlib.sha256(b"".join(chunks)).digest() == hashlib.sha256(expected).digest()
        assert kwargs["allow_redirects"] is False
        captured["upload"] = data
        response = Mock(status_code=200)
        response.json.return_value = {"ok": True}
        return response

    monkeypatch.setattr(http_client.requests, "post", post)
    monkeypatch.setattr(http_client, "validate_provider_endpoint", lambda value: None)
    assert http_client._post_json_request(
        label="image", url="https://example.test/image", headers={}, payload=payload,
        timeout=(60, 600), upload_timeout=180, timeout_message="timeout",
        request_error_message="failed", parse_error_message="invalid",
    ) == {"ok": True}
    assert captured["upload"].closed


def test_upload_total_deadline_is_bounded_even_while_chunks_keep_moving(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(http_client.time, "monotonic", lambda: now[0])
    with http_client._BoundedJsonUpload({"image": "a" * 200_000}, 180) as upload:
        assert upload.read(65536)
        now[0] = 281
        with pytest.raises(requests.Timeout, match="total deadline"):
            upload.read(65536)


@pytest.mark.asyncio
async def test_plan_timeout_is_504_and_never_automatically_resubmitted(monkeypatch):
    post = Mock(side_effect=requests.Timeout("provider took too long"))
    monkeypatch.setattr(http_client.requests, "post", post)
    monkeypatch.setattr(http_client, "validate_provider_endpoint", lambda value: None)
    monkeypatch.setattr(doubao, "resolve_provider", lambda *args: config_for(DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT, DOUBAO_IMAGE_AGENT_PLAN_MODEL))
    with pytest.raises(AIProxyUpstreamError) as caught:
        await doubao.generate_doubao_images(
            prompt="test", reference_inputs=[], size="2K", sequential="disabled", count=1,
        )
    assert caught.value.status_code == 504
    assert "勿连续重复提交" in caught.value.detail
    assert post.call_count == 1


def test_wrapped_write_timeout_is_classified_as_504(monkeypatch):
    post = Mock(side_effect=requests.ConnectionError(
        "Connection aborted.", TimeoutError("The write operation timed out"),
    ))
    monkeypatch.setattr(http_client.requests, "post", post)
    monkeypatch.setattr(http_client, "validate_provider_endpoint", lambda value: None)

    with pytest.raises(AIProxyUpstreamError) as caught:
        http_client._post_json_request(
            label="Doubao image",
            url="https://example.test/image",
            headers={},
            payload={"image": "large-base64"},
            timeout=(60, 120),
            timeout_message="upload timed out",
            request_error_message="failed",
            parse_error_message="invalid",
        )

    assert caught.value.status_code == 504
    assert caught.value.detail == "upload timed out"
    assert post.call_count == 1


@pytest.mark.asyncio
async def test_provider_submissions_are_serialized_instead_of_failing_the_second_request(monkeypatch):
    active = 0
    max_active = 0
    entered = []

    async def fake_post(*, config, payload):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        entered.append(payload["prompt"])
        await asyncio.sleep(0.01)
        active -= 1
        return [f'https://cdn.example.test/{payload["prompt"]}.jpg']

    monkeypatch.setattr(doubao, "_DOUBAO_IMAGE_SEMAPHORE", asyncio.Semaphore(1))
    monkeypatch.setattr(doubao, "_post_doubao_image_generation_unlocked", fake_post)
    config = config_for(DOUBAO_IMAGE_STANDARD_ENDPOINT, DOUBAO_IMAGE_PAYG_MODEL)

    first, second = await asyncio.gather(
        doubao._post_doubao_image_generation(
            config=config, payload={"prompt": "first"},
        ),
        doubao._post_doubao_image_generation(
            config=config, payload={"prompt": "second"},
        ),
    )

    assert first == ["https://cdn.example.test/first.jpg"]
    assert second == ["https://cdn.example.test/second.jpg"]
    assert entered == ["first", "second"]
    assert max_active == 1


def test_doubao_upstream_statuses_expose_only_safe_fallback_eligibility(monkeypatch):
    monkeypatch.setattr(http_client, "validate_provider_endpoint", lambda value: None)

    for upstream_status, expected_status in [(500, 503), (429, 503), (401, 503), (400, 422)]:
        response = Mock(status_code=upstream_status, text="provider detail")
        response.json.return_value = {}
        monkeypatch.setattr(http_client.requests, "post", Mock(return_value=response))
        with pytest.raises(AIProxyUpstreamError) as caught:
            http_client._post_json_request(
                label="Doubao image",
                url="https://example.test/image",
                headers={},
                payload={},
                timeout=(10, 120),
                timeout_message="timeout",
                request_error_message="failed",
                parse_error_message="invalid",
                expected_status=200,
                upstream_status_code=lambda status: (
                    503 if status in {401, 403, 429} or status >= 500 else 422
                ),
            )
        assert caught.value.status_code == expected_status

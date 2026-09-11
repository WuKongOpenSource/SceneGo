from external_api.video import base


class FakeJsonResponse:
    def __init__(self, data):
        self._data = data
        self.raise_for_status_called = False

    def raise_for_status(self):
        self.raise_for_status_called = True

    def json(self):
        return self._data


class FakeStreamResponse:
    def __init__(self, chunks):
        self._chunks = chunks
        self.raise_for_status_called = False
        self.headers = {}

    def raise_for_status(self):
        self.raise_for_status_called = True

    def iter_content(self, chunk_size):
        assert chunk_size == 4
        return iter(self._chunks)


def test_request_json_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeJsonResponse({"ok": True})

    def fake_request(method, url, **kwargs):
        calls["method"] = method
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "request", fake_request)

    data = base.request_json(
        "get",
        "https://example.test/tasks/task-1",
        headers={"Authorization": "Bearer token"},
        params={"task_id": "task-1"},
        timeout=17,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
    )

    assert data == {"ok": True}
    assert fake_response.raise_for_status_called
    assert calls["method"] == "GET"
    assert calls["url"] == "https://example.test/tasks/task-1"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["params"] == {"task_id": "task-1"}
    assert calls["kwargs"]["timeout"] == 17
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}


def test_request_multipart_json_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeJsonResponse({"id": "video-1"})
    image_handle = object()

    def fake_request(method, url, **kwargs):
        calls["method"] = method
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "request", fake_request)

    data = base.request_multipart_json(
        "post",
        "https://example.test/videos",
        headers={"Authorization": "Bearer token"},
        files={"input_reference": ("image.png", image_handle, "image/png")},
        data={"model": "sora2", "prompt": "move"},
        timeout=31,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
    )

    assert data == {"id": "video-1"}
    assert fake_response.raise_for_status_called
    assert calls["method"] == "POST"
    assert calls["url"] == "https://example.test/videos"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["files"] == {"input_reference": ("image.png", image_handle, "image/png")}
    assert calls["kwargs"]["data"] == {"model": "sora2", "prompt": "move"}
    assert calls["kwargs"]["timeout"] == 31
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}


def test_download_streaming_video_forwards_runtime_request_kwargs(monkeypatch):
    calls = {}
    fake_response = FakeStreamResponse([b"aa", b"", b"bb"])

    def fake_get(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return fake_response

    monkeypatch.setattr(base.requests, "get", fake_get)
    monkeypatch.setattr(base, "assert_public_http_url", lambda _url: None)

    data = base.download_streaming_video(
        "https://example.test/video.mp4",
        headers={"Authorization": "Bearer token"},
        timeout=99,
        request_kwargs={"proxies": {"https": "http://proxy.local"}},
        chunk_size=4,
        max_bytes=10,
    )

    assert data == b"aabb"
    assert fake_response.raise_for_status_called
    assert calls["url"] == "https://example.test/video.mp4"
    assert calls["kwargs"]["headers"] == {"Authorization": "Bearer token"}
    assert calls["kwargs"]["stream"] is True
    assert calls["kwargs"]["allow_redirects"] is False
    assert calls["kwargs"]["timeout"] == 99
    assert calls["kwargs"]["proxies"] == {"https": "http://proxy.local"}

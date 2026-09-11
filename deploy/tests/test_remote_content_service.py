from types import SimpleNamespace

import pytest

from services.remote_content_service import (
    RemoteContentTooLarge,
    read_aiohttp_response_limited,
    read_requests_response_limited,
    write_aiohttp_response_limited,
)


class RequestsResponse:
    def __init__(self, chunks, headers=None):
        self.chunks = chunks
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size):
        assert chunk_size == 3
        return iter(self.chunks)

    def close(self):
        self.closed = True


class AsyncChunks:
    def __init__(self, chunks):
        self.chunks = chunks

    async def iter_chunked(self, chunk_size):
        assert chunk_size == 3
        for chunk in self.chunks:
            yield chunk


def test_requests_reader_enforces_declared_and_observed_size():
    declared_response = RequestsResponse([], {"Content-Length": "6"})
    with pytest.raises(RemoteContentTooLarge):
        read_requests_response_limited(
            declared_response,
            max_bytes=5,
            chunk_size=3,
        )
    observed_response = RequestsResponse([b"abc", b"def"])
    with pytest.raises(RemoteContentTooLarge):
        read_requests_response_limited(
            observed_response,
            max_bytes=5,
            chunk_size=3,
        )
    assert declared_response.closed is True
    assert observed_response.closed is True


@pytest.mark.asyncio
async def test_aiohttp_reader_enforces_observed_size():
    response = SimpleNamespace(content_length=None, content=AsyncChunks([b"abc", b"def"]))

    with pytest.raises(RemoteContentTooLarge):
        await read_aiohttp_response_limited(response, max_bytes=5, chunk_size=3)


@pytest.mark.asyncio
async def test_aiohttp_disk_writer_removes_partial_file_on_overflow(tmp_path):
    response = SimpleNamespace(content_length=None, content=AsyncChunks([b"abc", b"def"]))
    destination = tmp_path / "partial.bin"

    with pytest.raises(RemoteContentTooLarge):
        await write_aiohttp_response_limited(
            response,
            destination,
            max_bytes=5,
            chunk_size=3,
        )

    assert destination.exists() is False

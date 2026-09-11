import pytest

from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited


class ChunkedUpload:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.read_sizes = []

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if not self.payload:
            return b""
        chunk, self.payload = self.payload[:size], self.payload[size:]
        return chunk


@pytest.mark.asyncio
async def test_read_upload_limited_reads_in_chunks():
    upload = ChunkedUpload(b"abcdefgh")

    assert await read_upload_limited(upload, max_bytes=8, chunk_size=3) == b"abcdefgh"
    assert upload.read_sizes == [3, 3, 3, 1]


@pytest.mark.asyncio
async def test_read_upload_limited_stops_one_byte_beyond_limit():
    upload = ChunkedUpload(b"abcdef")

    with pytest.raises(UploadPayloadTooLarge):
        await read_upload_limited(upload, max_bytes=5, chunk_size=4)
    assert upload.payload == b""


@pytest.mark.asyncio
async def test_read_upload_limited_rejects_invalid_limits():
    with pytest.raises(ValueError, match="max_bytes"):
        await read_upload_limited(ChunkedUpload(b"x"), max_bytes=0)

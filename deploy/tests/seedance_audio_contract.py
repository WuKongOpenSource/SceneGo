"""Real reference-audio fixtures and pre-billing assertions for both services."""
import base64
import io
import wave
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from services import seedance_audio_validation_service as audio


def wav_bytes(seconds):
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        writer.writeframes(b'\x00\x00' * round(seconds * 8000))
    return output.getvalue()


def data(seconds, **kwargs):
    return {'kind': 'audio', 'url': 'data:audio/wav;base64,' + base64.b64encode(wav_bytes(seconds)).decode(), **kwargs}


async def assert_audio_rejected_before_billing(service):
    service.queue.enqueue = AsyncMock()
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()), \
         patch('services.task_credit_billing_service.reserve_task_credits', new=AsyncMock()) as reserve:
        with pytest.raises(HTTPException) as caught:
            await service.submit('seedance_multi', {'sub_model': 'mini', 'media_inputs': [data(15.804)]}, 'user', prepare=False)
    assert caught.value.status_code == 400
    assert '15.804' in caught.value.detail
    reserve.assert_not_awaited()
    service.queue.enqueue.assert_not_awaited()

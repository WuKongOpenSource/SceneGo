"""Preserve audio submission contracts in the public application."""
from tts_enqueue_contract import (
    TtsEnqueueContract,
    public_tts_backend as tts_backend,
    tts_client as client,
)


class TestPublicTtsEnqueue(TtsEnqueueContract):
    pass

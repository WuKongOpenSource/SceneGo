
import sys

from services import audio_mix_service as _implementation

sys.modules[__name__] = _implementation

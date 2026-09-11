
import sys

from external_api.audio import minimax_audio as _impl

sys.modules[__name__] = _impl

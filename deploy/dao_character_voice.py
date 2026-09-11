
import sys

from dao.creative import character_voice as _implementation

sys.modules[__name__] = _implementation

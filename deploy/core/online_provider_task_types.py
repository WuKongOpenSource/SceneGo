"""Task-type allowlist for work executed by configured online providers.

The public source boundary imports this module instead of the private local-node
task catalog.  A task not named here must fail closed in the online worker.
"""
from __future__ import annotations


ONLINE_PROVIDER_TASK_TYPES_EXACT = frozenset(
    {
        "minimax_i2v",
        "minimax_morph",
        "minimax_tts",
        "sora2_i2v",
        "sora2_morph",
        "veo_i2v",
        "veo_morph",
        "wan26_i2v",
        "video_reverse_prompt",
        "jimeng_multimodal",
    }
)
ONLINE_PROVIDER_TASK_TYPE_PREFIXES = ("seedance_", "kling_", "vidu_", "happyhorse_")


def is_online_provider_task(task_type: str) -> bool:
    """Return whether the online-provider worker may execute ``task_type``."""
    normalized = str(task_type or "").strip().lower()
    if not normalized:
        return False
    if normalized in ONLINE_PROVIDER_TASK_TYPES_EXACT:
        return True
    return any(normalized.startswith(prefix) for prefix in ONLINE_PROVIDER_TASK_TYPE_PREFIXES)

"""Product and input contract for the official Jimeng CLI connector.

The product label is intentionally separate from the provider execution model.
Never route this task through the Ark client or silently change provider/model.
"""
from __future__ import annotations

import math
from typing import Any, Mapping

TASK_TYPE = "jimeng_multimodal"
MODEL_KEY = "JimengSeedance2"
MODEL_LABEL = "Jimeng·Seedance 2.0 · 真人视频模型"
EXECUTION_MODEL = "seedance2.0mini"
RATIOS = ("1:1", "3:4", "16:9", "4:3", "9:16", "21:9")


class JimengError(ValueError):
    """A safe, creator-readable error; raw CLI output never belongs here."""


def is_jimeng_task(data: Mapping[str, Any]) -> bool:
    return data.get("task_type") == TASK_TYPE or data.get("model") == MODEL_KEY


def normalize_jimeng_options(data: Mapping[str, Any]) -> dict[str, Any]:
    if data.get("task_type") != TASK_TYPE:
        raise JimengError("即梦模型只能通过独立全能参考通道提交。")
    if data.get("model") not in (None, MODEL_KEY):
        raise JimengError("即梦任务模型不匹配，请重新选择模型。")
    if data.get("portrait_reference_mode"):
        raise JimengError("即梦不支持仿真人参考模式，请关闭该选项后重新提交。")
    if data.get("entity_type") not in (None, "", "video_segment") or data.get("file_role") not in (None, "", "video"):
        raise JimengError("即梦真人视频只能保存为视频素材或镜头视频。")
    if str(data.get("resolution") or "720p").lower() != "720p":
        raise JimengError("即梦真人视频当前只支持 720P，本次未提交。")
    try:
        requested = float(data.get("duration", 5))
    except (ValueError, TypeError, OverflowError) as exc:
        raise JimengError("即梦生成时长无效。") from exc
    if not math.isfinite(requested) or requested <= 0 or requested > 15:
        raise JimengError("即梦生成时长需在 4–15 秒内；短脚本至少生成 4 秒。")
    duration = max(4, math.ceil(requested))
    ratio = str(data.get("ratio") or "16:9")
    if ratio not in RATIOS:
        raise JimengError("即梦需要明确画面比例，请选择 16:9、9:16 等固定比例。")
    if data.get("seed") not in (None, -1):
        raise JimengError("官方即梦 CLI 暂不支持指定随机种子，请使用默认设置。")
    if data.get("draft_task_id") or data.get("camera_fixed") or data.get("tools"):
        raise JimengError("即梦全能参考不支持样片复用、固定镜头或扩展工具参数。")
    if data.get("generate_audio") is False or data.get("watermark") is True:
        raise JimengError("官方即梦 CLI 暂未提供可验证的声音或水印开关，请使用默认设置。")
    if data.get("reference_audio_policy") not in (None, "preserve"):
        raise JimengError("即梦当前保留完整参考配音；请手动裁剪参考副本后重新选择。")
    media = data.get("media_inputs")
    if not isinstance(media, list) or not media or len(media) > 12:
        raise JimengError("即梦全能参考需有图片或视频，全部参考素材最多 12 个。")
    counts = {"image": 0, "video": 0, "audio": 0}
    for item in media:
        if not isinstance(item, dict) or item.get("kind") not in counts:
            raise JimengError("即梦参考素材类型无效。")
        if not (item.get("file_id") or item.get("url")):
            raise JimengError("参考素材缺少原文件，请重新选择。")
        counts[item["kind"]] += 1
    if counts["image"] > 9 or counts["video"] > 3 or counts["audio"] > 3:
        raise JimengError("即梦最多使用 9 张图、3 段视频和 3 段音频，总数不超过 12。")
    if not (counts["image"] or counts["video"]):
        raise JimengError("即梦全能参考不能仅使用音频，请添加图片或视频。")
    prompt = str(data.get("prompt") or "").strip()
    if not prompt or len(prompt) > 10000:
        raise JimengError("请输入不超过 10000 字的即梦视频提示词。")
    # Foreign provider pricing fields must not override this connector's quote.
    clean = {k: v for k, v in data.items()
             if k not in {"workflow_type", "requested_workflow_type", "model_name"}
             and not k.startswith(("hh_", "minimax_", "kling_", "vidu_", "sub_model_"))}
    return {**clean, "task_type": TASK_TYPE, "model": MODEL_KEY, "provider": "jimeng",
            "execution_model": EXECUTION_MODEL, "sub_model": "jimeng_mini", "category": "video",
            "display_name": MODEL_LABEL, "resolution": "720p", "ratio": ratio,
            "duration": duration, "requested_duration": requested, "prompt": prompt}


def capability(*, available: bool = False, reason: str = "即梦账号尚未配置或授权") -> dict:
    return {"key": MODEL_KEY, "label": MODEL_LABEL, "display_name": MODEL_LABEL,
            "provider": "jimeng", "model_name": EXECUTION_MODEL,
            "available": available, "published": True, "unavailable_reason": "" if available else reason,
            "task_types": [TASK_TYPE], "resolutions": ["720p"], "ratios": list(RATIOS),
            "duration_min": 4, "duration_max": 15, "supports_multimodal": True,
            "media_inputs": ["text", "reference_image", "reference_video", "reference_audio"],
            "supports_original_audio": True, "supports_cancel": False, "query_mode": "async",
            "parameter_rules": {"resolution": ["720p"], "ratio": list(RATIOS),
                                "duration": {"type": "integer", "minimum": 4, "maximum": 15},
                                "normalization_policy": "reject_or_explain"},
            "pricing_multiplier": 1, "pricing_reference_model": "Seedance2",
            "notice": "实际执行 seedance2.0mini；需遵守即梦审核规则，不保证所有人物素材通过。"}

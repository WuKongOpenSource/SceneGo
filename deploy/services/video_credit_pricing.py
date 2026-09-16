"""Authoritative video-generation credit pricing.

The browser may request a preview, but queued-task billing always calls this
module again with the persisted task payload.  Never accept a caller supplied
credit amount.

The external-API conversion is anchored to the product decision that a
5-second HappyHorse 1.0 1080P request costs 160 credits. HappyHorse's public
list price is CNY 1.60/second. External API prices use the product-friendly
conversion of 20 credits/CNY.
Local workflows have no per-call provider fee. Standard and Fast H3 use the
10-credit product minimum, while H3 Mini uses 5 credits. The optional serial
720P post-upscale is a separate local workflow and adds 5 credits to every H3
profile when requested.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
import math
from typing import Any, Dict, Mapping, Sequence, Tuple


VIDEO_PRICING_VERSION = "2026-09-02-video-cost-v4"
CREDITS_PER_CNY = Decimal("20")
LOCAL_VIDEO_CREDITS = 10
LOCAL_H3_MINI_CREDITS = 5
LOCAL_720P_UPSCALE_CREDITS = 5
SEEDANCE_UNKNOWN_REFERENCE_VIDEO_SECONDS = Decimal("15")
SEEDANCE_MINIMUM_REFERENCE_VIDEO_SECONDS = Decimal("4")

# Volcengine list-price examples for a 5-second, 16:9 output without video
# input.  Fast/Mini promotion prices are deliberately excluded: the temporary
# discount must remain a cost buffer instead of turning into a loss when it
# expires.  Source: https://docs.volcengine.com/docs/82379/1544106
SEEDANCE_NO_VIDEO_FIVE_SECOND_COST_CNY = {
    "mini": {"480P": Decimal("1.16"), "720P": Decimal("2.48")},
    "fast": {"480P": Decimal("1.86"), "720P": Decimal("4.00")},
    "standard": {
        "480P": Decimal("2.31"),
        "720P": Decimal("4.97"),
        "1080P": Decimal("12.39"),
        "4K": Decimal("25.27"),
    },
}

# Provider list-price cost per combined input/output second when a reference
# video is present. Values reproduce the official 5-second output examples
# across the four-to-fifteen-second input range without accumulating rounding.
SEEDANCE_WITH_VIDEO_PER_SECOND_COST_CNY = {
    "mini": {"480P": Decimal("0.1405"), "720P": Decimal("0.3024")},
    "fast": {"480P": Decimal("0.221"), "720P": Decimal("0.4752")},
    "standard": {
        "480P": Decimal("0.281"),
        "720P": Decimal("0.6048"),
        "1080P": Decimal("1.5065"),
        "4K": Decimal("3.1105"),
    },
}

# Product prices for requests without reference-video input.  They are rounded
# above provider cost * 20 credits/CNY to leave room for gift credits, storage,
# payment fees, and operations. Reference-video requests are calculated below.
SEEDANCE_BASE_FIVE_SECOND_CREDITS = {
    "mini": {"480P": 35, "720P": 50},
    "fast": {"480P": 50, "720P": 85},
    "standard": {"480P": 65, "720P": 105, "1080P": 260, "4K": 520},
}

LOCAL_MODELS = frozenset(
    {
        "wan2",
        "ltxnode1",
        "wannode2",
        "一阶",
        "二阶",
        "三阶",
        "四阶",
        "五阶",
        "六阶",
        "七阶",
        "minimaxh3",
        "minimaxh3fast",
        "minimaxh3mini",
    }
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _lower(value: Any) -> str:
    return _text(value).lower()


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default
    return parsed if parsed > 0 else default


def _resolution(params: Mapping[str, Any], default: str = "720P") -> str:
    raw = (
        params.get("hh_resolution")
        or params.get("vidu_resolution")
        or params.get("minimax_resolution")
        or params.get("resolution")
        or default
    )
    value = _text(raw).upper().replace(" ", "")
    aliases = {
        "480": "480P",
        "480P": "480P",
        "540": "540P",
        "540P": "540P",
        "720": "720P",
        "720P": "720P",
        "768": "768P",
        "768P": "768P",
        "1080": "1080P",
        "1080P": "1080P",
        "2160": "4K",
        "2160P": "4K",
        "4K": "4K",
        "3840X2160": "4K",
        "3840*2160": "4K",
        "1280X704": "720P",
        "1280*704": "720P",
    }
    return aliases.get(value, default)


def _credits_from_cny_per_second(rate: str, duration: int) -> Tuple[int, Decimal]:
    provider_cost = Decimal(rate) * Decimal(duration)
    credits = int((provider_cost * CREDITS_PER_CNY).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(LOCAL_VIDEO_CREDITS, credits), provider_cost


def _positive_decimal(value: Any) -> Decimal | None:
    try:
        parsed = Decimal(str(value))
    except (TypeError, ValueError, ArithmeticError):
        return None
    return parsed if parsed > 0 else None


def _ceil_credits_to_five(provider_cost: Decimal) -> int:
    whole_credits = int(
        (provider_cost * CREDITS_PER_CNY).to_integral_value(rounding=ROUND_CEILING)
    )
    return max(LOCAL_VIDEO_CREDITS, ((whole_credits + 4) // 5) * 5)


def _seedance_tier(params: Mapping[str, Any]) -> str:
    model = _lower(params.get("model"))
    sub_model = _lower(params.get("sub_model"))
    if "mini" in model or sub_model == "mini":
        return "mini"
    if "fast" in model or sub_model == "fast":
        return "fast"
    if model == "seedance15" or sub_model == "agent_plan":
        return "1.5"
    return "standard"


def _reference_video_durations(params: Mapping[str, Any]) -> Tuple[Decimal, int, bool]:
    raw_durations: Sequence[Any] = ()
    explicit = params.get("reference_video_durations")
    if isinstance(explicit, (list, tuple)):
        raw_durations = explicit
    else:
        media_inputs = params.get("media_inputs")
        if isinstance(media_inputs, (list, tuple)):
            raw_durations = [
                item.get("duration_seconds")
                or item.get("duration")
                or (
                    Decimal(str(item.get("duration_ms"))) / Decimal("1000")
                    if _positive_decimal(item.get("duration_ms")) is not None
                    else None
                )
                for item in media_inputs
                if isinstance(item, Mapping) and _lower(item.get("kind")) == "video"
            ]

    try:
        requested_count = max(0, int(params.get("reference_video_count") or 0))
    except (TypeError, ValueError, OverflowError):
        requested_count = 0
    count = max(requested_count, len(raw_durations))
    if count == 0 and bool(params.get("has_reference_video")):
        count = 1
    if count == 0:
        return Decimal("0"), 0, False

    total = Decimal("0")
    defaulted = False
    for index in range(count):
        duration = _positive_decimal(raw_durations[index]) if index < len(raw_durations) else None
        if duration is None:
            duration = SEEDANCE_UNKNOWN_REFERENCE_VIDEO_SECONDS
            defaulted = True
        total += max(duration, SEEDANCE_MINIMUM_REFERENCE_VIDEO_SECONDS)
    return total, count, defaulted


def validate_seedance_generation_options(params: Mapping[str, Any] | None) -> None:
    """Reject provider-unsupported combinations before credits are frozen."""
    data = params or {}
    if _infer_family(data) != "seedance":
        return
    tier = _seedance_tier(data)
    raw_duration = data.get("duration")
    if raw_duration is None:
        raw_duration = data.get("duration_seconds", 5)
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        duration = 0.0
    max_duration = 12 if tier == "1.5" else 15
    if not 4 <= duration <= max_duration or not duration.is_integer():
        label = "1.5 Pro" if tier == "1.5" else "2.0"
        raise ValueError(f"Seedance {label} 需要 4–{max_duration} 秒整数时长，请调整后生成")
    resolution = _resolution(data, "720P")
    if tier in {"fast", "mini"} and resolution not in {"480P", "720P"}:
        label = "Fast" if tier == "fast" else "Mini"
        raise ValueError(f"Seedance 2.0 {label} 仅支持 480P 和 720P，请调整分辨率后重试")


def _fixed_quote(
    credits: int,
    profile: str,
    *,
    minimum_credits: int = LOCAL_VIDEO_CREDITS,
    **extra: Any,
) -> Dict[str, Any]:
    return {
        "credits": max(int(minimum_credits), int(credits)),
        "profile": profile,
        "pricing_version": VIDEO_PRICING_VERSION,
        **extra,
    }


def _per_second_quote(rate: str, duration: int, profile: str, resolution: str) -> Dict[str, Any]:
    credits, provider_cost = _credits_from_cny_per_second(rate, duration)
    return _fixed_quote(
        credits,
        profile,
        duration_seconds=duration,
        resolution=resolution,
        provider_cost_cny=str(provider_cost.normalize()),
        conversion_credits_per_cny=str(CREDITS_PER_CNY),
    )


def _infer_family(params: Mapping[str, Any]) -> str:
    task_type = _lower(params.get("task_type"))
    model = _lower(params.get("model") or params.get("video_model"))

    if task_type == "jimeng_multimodal" or model == "jimengseedance2":
        return "jimeng"

    if task_type.startswith("happyhorse_") or model == "happyhorse":
        return "happyhorse"
    if task_type.startswith("vidu_") or model == "vidu":
        return "vidu"
    if task_type.startswith("kling_") or model == "kling":
        return "kling"
    if task_type == "wan26_i2v" or model == "大能":
        return "wan26"
    if task_type.startswith("seedance_") or model.startswith("seedance"):
        return "seedance"
    if task_type.startswith("minimax_") or model == "mini":
        return "minimax-api"
    if task_type.startswith("sora2_") or model == "sora2":
        return "sora2"
    if task_type.startswith("veo_") or model == "veo":
        return "veo"
    if model in LOCAL_MODELS or task_type in {"i2v", "morph"}:
        return "local"
    return "unknown"


def _quote_minimax(params: Mapping[str, Any]) -> Dict[str, Any]:
    model = _lower(params.get("minimax_model") or params.get("model_name") or params.get("model"))
    fast = "fast" in model
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 6)
    resolution = _resolution(params, "768P")
    key = (resolution, 10 if duration == 10 else 6)
    standard = {("768P", 6): 40, ("768P", 10): 80, ("1080P", 6): 70}
    fast_prices = {("768P", 6): 27, ("768P", 10): 45, ("1080P", 6): 46}
    table = fast_prices if fast else standard
    normalized_key = key if key in table else ("768P", 6)
    return _fixed_quote(
        table[normalized_key],
        "minimax-hailuo-fast" if fast else "minimax-hailuo",
        duration_seconds=normalized_key[1],
        resolution=normalized_key[0],
    )


def _quote_seedance(params: Mapping[str, Any]) -> Dict[str, Any]:
    tier = _seedance_tier(params)
    resolution = _resolution(params, "720P")
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 5)
    if tier == "1.5":
        # Agent Plan's Seedance 1.5 entry remains roughly one third of the
        # matching Seedance 2.0 Standard tier and does not accept video input.
        base = {"480P": 22, "720P": 32, "1080P": 45}.get(resolution, 32)
        credits = int(
            (Decimal(base) * Decimal(duration) / Decimal(5)).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        return _fixed_quote(
            credits,
            "seedance-1.5",
            duration_seconds=duration,
            resolution=resolution,
            basis="agent-plan-product-tier",
        )

    supported_costs = SEEDANCE_NO_VIDEO_FIVE_SECOND_COST_CNY[tier]
    if resolution not in supported_costs:
        # Pricing previews normalize stale Fast/Mini 1080P state to 720P. The
        # generation route rejects it before reservation; this branch keeps a
        # stale browser estimate from becoming a server error.
        resolution = "720P"
    base = SEEDANCE_BASE_FIVE_SECOND_CREDITS[tier][resolution]
    credits = int((Decimal(base) * Decimal(duration) / Decimal(5)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    reference_seconds, reference_count, duration_defaulted = _reference_video_durations(params)
    provider_cost = (
        supported_costs[resolution] * Decimal(duration) / Decimal("5")
    )
    if reference_count:
        combined_seconds = Decimal(duration) + reference_seconds
        provider_cost = SEEDANCE_WITH_VIDEO_PER_SECOND_COST_CNY[tier][resolution] * combined_seconds
        credits = max(credits, _ceil_credits_to_five(provider_cost))
    return _fixed_quote(
        credits,
        f"seedance-{tier}",
        duration_seconds=duration,
        resolution=resolution,
        reference_video_count=reference_count,
        reference_video_seconds=str(reference_seconds.normalize()) if reference_count else "0",
        reference_video_duration_defaulted=duration_defaulted,
        provider_cost_cny=str(provider_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        conversion_credits_per_cny=str(CREDITS_PER_CNY),
        basis="ark-seedance-list-price",
    )


def _quote_vidu(params: Mapping[str, Any]) -> Dict[str, Any]:
    task_type = _lower(params.get("task_type"))
    sub_model = _lower(params.get("sub_model") or "q3")
    resolution = _resolution(params, "720P")
    duration = _positive_int(params.get("duration_seconds") or params.get("duration"), 5)
    reference = task_type != "vidu_morph"

    if reference:
        rates = {
            "q3-mix": {"720P": "0.78125", "1080P": "0.9375"},
            "q3": {"540P": "0.3125", "720P": "0.625", "1080P": "0.78125"},
            "q3-turbo": {"540P": "0.15625", "720P": "0.3125", "1080P": "0.40625"},
            "q2-pro": {"540P": "0.25", "720P": "0.3125", "1080P": "0.78125"},
            "q2": {"540P": "0.21875", "720P": "0.28125", "1080P": "0.71875"},
            "q2-turbo": {"540P": "0.0875", "720P": "0.25", "1080P": "0.46875"},
        }
    else:
        rates = {
            "q3-pro": {"540P": "0.3125", "720P": "0.78125", "1080P": "0.9375"},
            "q3": {"540P": "0.3125", "720P": "0.78125", "1080P": "0.9375"},
            "q3-turbo": {"540P": "0.25", "720P": "0.375", "1080P": "0.4375"},
            "q2-pro": {"540P": "0.15625", "720P": "0.34375", "1080P": "0.71875"},
            "q2": {"540P": "0.15625", "720P": "0.34375", "1080P": "0.71875"},
            "q2-turbo": {"540P": "0.0875", "720P": "0.25", "1080P": "0.46875"},
        }
    model_rates = rates.get(sub_model) or rates.get("q3") or next(iter(rates.values()))
    rate = model_rates.get(resolution) or model_rates.get("720P") or next(iter(model_rates.values()))
    return _per_second_quote(rate, duration, f"vidu-{sub_model}-{'reference' if reference else 'start-end'}", resolution)


def quote_video_credits(params: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Return the server-owned quote for one video generation task."""
    data: Mapping[str, Any] = params or {}
    family = _infer_family(data)

    if family == "local":
        model = _lower(data.get("model") or data.get("video_model"))
        is_h3 = model in {"minimaxh3", "minimaxh3fast", "minimaxh3mini"}
        is_h3_mini = model == "minimaxh3mini"
        base_credits = LOCAL_H3_MINI_CREDITS if is_h3_mini else LOCAL_VIDEO_CREDITS
        upscale_720p = is_h3 and data.get("h3_upscale_720p") is True
        credits = base_credits + (LOCAL_720P_UPSCALE_CREDITS if upscale_720p else 0)
        return _fixed_quote(
            credits,
            "local-720p-upscale" if upscale_720p else "local",
            minimum_credits=base_credits,
            duration_seconds=_positive_int(data.get("duration_seconds"), 5),
            base_credits=base_credits,
            h3_upscale_720p=upscale_720p,
            upscale_credits=LOCAL_720P_UPSCALE_CREDITS if upscale_720p else 0,
        )
    if family == "minimax-api":
        return _quote_minimax(data)
    if family == "seedance":
        return _quote_seedance(data)
    if family == "jimeng":
        # Compare the same effective output duration, resolution and reference
        # video inputs against the live Standard product rule, not Mini pricing
        # or the provider account's unrelated point denomination.
        raw_duration = data.get("duration_seconds")
        requested = float(data.get("duration", 5) if raw_duration is None else raw_duration)
        if not math.isfinite(requested) or requested <= 0 or requested > 15:
            raise ValueError("即梦生成时长无效")
        reference = _quote_seedance({**data, "model": "Seedance2", "sub_model": "standard",
                                    "duration_seconds": max(4, math.ceil(requested)),
                                    "duration": max(4, math.ceil(requested))})
        return _fixed_quote(reference["credits"], "jimeng-seedance-mini",
                            duration_seconds=reference["duration_seconds"], resolution=reference["resolution"],
                            reference_video_count=reference.get("reference_video_count", 0),
                            reference_video_seconds=reference.get("reference_video_seconds", "0"),
                            reference_video_duration_defaulted=reference.get("reference_video_duration_defaulted", False),
                            reference_model="Seedance2", reference_credits=reference["credits"],
                            multiplier=1, basis="seedance-standard-product-price")

    duration_defaults = {"sora2": 15, "veo": 8}
    duration = _positive_int(data.get("duration_seconds") or data.get("duration"), duration_defaults.get(family, 5))
    if family == "happyhorse":
        resolution = _resolution(data, "1080P")
        rate = "1.6" if resolution == "1080P" else "0.9"
        return _per_second_quote(rate, duration, "happyhorse-1.0-r2v", resolution)
    resolution = _resolution(data, "1080P" if family == "wan26" else "720P")
    if family == "kling":
        has_reference = bool(data.get("has_reference_video"))
        with_audio = bool(data.get("audio"))
        expensive = has_reference or with_audio
        rate = ("1.2" if expensive else "0.8") if resolution == "1080P" else ("0.9" if expensive else "0.6")
        return _per_second_quote(rate, duration, "kling-v3", resolution)
    if family == "vidu":
        return _quote_vidu(data)
    if family == "wan26":
        rate = "1.0" if resolution == "1080P" else "0.6"
        return _per_second_quote(rate, duration, "wan2.6-i2v", resolution)
    if family == "sora2":
        # Active gateway model is a fixed 15-second landscape SKU.  The tier is
        # kept below same-duration HappyHorse while remaining above local/API
        # economy models.
        return _fixed_quote(120, "sora2-gateway-15s", duration_seconds=duration, resolution=resolution)
    if family == "veo":
        return _fixed_quote(110, "veo-3.1-fast-gateway", duration_seconds=duration, resolution=resolution)

    # Unknown legacy video task: charge the local minimum rather than making a
    # generation free or trusting a caller-provided price.
    return _fixed_quote(LOCAL_VIDEO_CREDITS, "legacy-unknown", duration_seconds=duration, resolution=resolution)

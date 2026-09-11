import pytest

from schemas.generation import GenerateRequest
from services.seedance_task_identity import seedance_task_identity
from services.task_notification_service import _enrich_task_row_from_data
from services.video_credit_pricing import validate_seedance_generation_options


@pytest.mark.parametrize("seconds", [3, 3.5, 0, -1, 13, float("nan"), float("inf"), "bad"])
def test_unsupported_one_five_seconds_fail_before_billing(seconds):
    with pytest.raises(ValueError, match="4–12"):
        validate_seedance_generation_options(
            {
                "task_type": "seedance_morph",
                "sub_model": "agent_plan",
                "duration": seconds,
            }
        )


@pytest.mark.parametrize("seconds", [4, 5, 6, 11, 12])
def test_calibrated_duration_kept_exactly(seconds):
    request = GenerateRequest(
        task_type="seedance_morph",
        sub_model="agent_plan",
        duration=seconds,
    )
    validate_seedance_generation_options(request.model_dump())
    assert request.duration == seconds
    assert request.model == "Seedance15"
    assert request.model_dump()["display_name"] == "Seedance 1.5 Pro · 首尾帧过渡"


def test_old_terminal_rows_derive_model_from_routing_not_wan_default_and_keep_error():
    row = _enrich_task_row_from_data(
        {
            "task_type": "seedance_morph",
            "display_name": "Seedance 2.0",
            "error_message": "duration=3 unsupported",
            "task_data": {"sub_model": "agent_plan", "model": "Wan2"},
        }
    )
    assert row["model"] == "Seedance15"
    assert row["display_name"] == "Seedance 1.5 Pro · 首尾帧过渡"
    assert row["error_message"] == "duration=3 unsupported"
    assert "task_data" not in row
    assert seedance_task_identity({"task_type": "seedance_morph"}) == {
        "provider": "seedance",
        "category": "video",
    }


async def test_public_capabilities_expose_submission_duration_bounds(monkeypatch):
    from unittest.mock import AsyncMock

    from services import public_video_capability_service as public

    monkeypatch.setattr(public, "load_public_video_catalog", AsyncMock(return_value=None))
    monkeypatch.setattr(public, "list_cached_provider_health", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        public,
        "_provider_runtime_state",
        lambda *args, **kwargs: (False, "", "unconfigured"),
    )
    monkeypatch.setattr(public, "resolve_seedance_model_name", lambda *args, **kwargs: "")
    monkeypatch.setattr(public, "_dashscope_options", lambda *args, **kwargs: [])

    manifest = await public.get_public_video_capabilities()
    for model in manifest["models"]:
        if model["key"] not in {"Seedance15", "Seedance2", "Seedance2Fast", "Seedance2Mini"}:
            continue
        duration = model["parameter_rules"]["duration"]
        assert duration["minimum"] == 4
        assert duration["maximum"] == (12 if model["key"] == "Seedance15" else 15)

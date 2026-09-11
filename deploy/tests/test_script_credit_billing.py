import pytest

from services import credit_service


def test_compute_cost_combines_token_shot_and_model_factors():
    rule = {
        "base_cost": 1,
        "min_cost": 1,
        "max_cost": 1000,
        "factors": [
            {"key": "shot_count", "type": "linear_add", "cost_per_unit": 2},
            {"key": "input_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 1},
            {"key": "output_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 3},
            {
                "key": "model",
                "type": "enum",
                "rules": [{"value": "premium", "multiplier": 1.5}],
                "default_multiplier": 1,
            },
        ],
    }

    # (base 1 + shots 4 + input 2 + output 3) * premium 1.5 = 15
    assert credit_service.compute_cost(
        rule,
        {"shot_count": 2, "input_tokens": 1001, "output_tokens": 600, "model": "premium"},
    ) == 15


def test_compute_cost_applies_public_script_model_tiers():
    rule = {
        "feature_key": "script_model_call",
        "base_cost": 1,
        "min_cost": 1,
        "max_cost": 1000,
        "factors": [
            {"key": "input_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 1},
            {"key": "output_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 2},
            {
                "key": "model",
                "type": "enum",
                "rules": [
                    {"value": "script_tier_1", "multiplier": 1},
                    {"value": "script_tier_2", "multiplier": 2},
                    {"value": "script_tier_3", "multiplier": 3},
                    {"value": "script_tier_4", "multiplier": 4},
                ],
                "default_multiplier": 1,
            },
        ],
    }

    params = {"input_tokens": 1001, "output_tokens": 1001}
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_1"}) == 3
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_2"}) == 5
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_3"}) == 8
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_4"}) == 10


def test_compute_cost_caps_storyboard_prompt_generation_for_public_tiers():
    rule = {
        "feature_key": "storyboard_design_generation",
        "base_cost": 1,
        "min_cost": 1,
        "max_cost": 1000,
        "factors": [
            {"key": "shot_count", "type": "linear_add", "cost_per_unit": 2},
            {"key": "input_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 1},
            {"key": "output_tokens", "type": "per_unit_add", "unit_size": 1000, "cost_per_unit": 2},
            {
                "key": "model",
                "type": "enum",
                "rules": [
                    {"value": "script_tier_1", "multiplier": 1},
                    {"value": "script_tier_2", "multiplier": 2},
                    {"value": "script_tier_3", "multiplier": 3},
                    {"value": "script_tier_4", "multiplier": 4},
                ],
                "default_multiplier": 1,
            },
        ],
    }

    params = {"shot_count": 21, "input_tokens": 6000, "output_tokens": 12000}
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_1"}) == 2
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_2"}) == 5
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_3"}) == 8
    assert credit_service.compute_cost(rule, {**params, "model": "script_tier_4"}) == 10


@pytest.mark.asyncio
async def test_consume_usage_reuses_existing_consumption(monkeypatch):
    async def existing(*_args, **_kwargs):
        return {
            "transaction_id": "txn_1",
            "amount": 7,
            "balance_after": 93,
        }

    monkeypatch.setattr(credit_service.CreditTransactionDAO, "get_consumption_for_task", existing)

    result = await credit_service.consume_usage(
        "user",
        "user_1",
        feature_key="script_model_call",
        params={"input_tokens": 1000},
        task_id="script_turn_1",
    )

    assert result["idempotent"] is True
    assert result["charged_credits"] == 7
    assert result["transaction_id"] == "txn_1"

import pytest

from services.wechat_recharge_service import (
    WechatRechargeError,
    quote_recharge,
    quote_recharge_amount,
)


@pytest.mark.parametrize(
    ("amount_fen", "point_amount", "discount_bps"),
    [
        (1_000, 102, 9_800),
        (5_000, 526, 9_500),
        (10_000, 1_111, 9_000),
        (20_000, 2_500, 8_000),
    ],
)
def test_custom_amount_anchor_prices(amount_fen, point_amount, discount_bps):
    quote = quote_recharge_amount(amount_fen)

    assert quote["amount_fen"] == amount_fen
    assert quote["point_amount"] == point_amount
    assert quote["discount_bps"] == discount_bps


def test_custom_amount_stays_exact_and_rounds_points_down():
    quote = quote_recharge_amount(20_001)

    assert quote["amount_fen"] == 20_001
    assert quote["point_amount"] == 2_500
    assert quote["discount_bps"] == 8_000


def test_arbitrary_point_quote_remains_supported():
    quote = quote_recharge(3_000)

    assert quote["point_amount"] == 3_000
    assert quote["amount_fen"] == 24_000
    assert quote["discount_bps"] == 8_000


def test_custom_amount_rejects_less_than_ten_fen():
    with pytest.raises(WechatRechargeError, match="0.10"):
        quote_recharge_amount(9)


def test_custom_amount_enforces_server_point_cap():
    with pytest.raises(WechatRechargeError, match="不能超过"):
        quote_recharge_amount(20_000, max_point_amount=2_499)

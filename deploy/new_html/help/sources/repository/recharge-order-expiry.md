# Recharge order timeout

An unpaid WeChat recharge order is marked **Failed** once it reaches 12 hours
from its original creation time. The reason is shown in the recharge ledger.
This applies to pending orders and QR-expired orders without a confirmed payment;
it does not extend the QR code's existing, shorter validity period.

The application checks on startup and once per minute, so this does not depend
on a browser staying open. Each scan processes at most 500 rows, skipping locked
orders; any remaining or locked rows are revisited. Order retrieval and the
admin ledger also check for overdue orders before returning results. Existing
overdue orders are included when the new code starts.

This is a local timeout, not a refund or a claim that the payment provider has
rejected the transaction. A subsequent authenticated, amount-verified successful
notification or active reconciliation can still settle a timed-out order.
Settlement remains atomic and idempotent. An actual provider rejection or a
closed order is not reopened by this exception.

Already-paid orders, orders with a transaction ID or paid timestamp, and orders
with an existing credit-ledger entry are excluded from timeout scans. Stale
query responses and create failures must not overwrite a concurrently settled
order. No order, payment record, or credit history is deleted.

## Verification

`tests/test_wechat_recharge_expiry.py` covers the interval, scoped reads, startup
scan, retry and late reconciliation. `tests/test_wechat_recharge_settlement.py`
covers exact-once crediting from a timeout and rejection of invalid transitions.

`tests/test_wechat_recharge_expiry_postgres.py` additionally exercises actual
PostgreSQL row locking, boundary timestamps and concurrent settlement. It is
opt-in using `RECHARGE_TEST_PG_PORT`, against a disposable loopback test instance
with role `recharge_test` and database `postgres`. Each test creates and removes
only its own randomly named schema. Never point this fixture at production.

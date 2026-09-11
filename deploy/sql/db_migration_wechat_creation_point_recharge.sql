-- WeChat Pay APIv3 Native orders for permanent creation-point recharge.


CREATE TABLE IF NOT EXISTS wechat_creation_point_orders (
    id BIGSERIAL PRIMARY KEY,
    payment_order_id VARCHAR(64) UNIQUE NOT NULL,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    out_trade_no VARCHAR(32) UNIQUE NOT NULL,
    point_amount INTEGER NOT NULL CHECK (point_amount > 0),
    base_amount_fen INTEGER NOT NULL CHECK (base_amount_fen > 0),
    discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 8000 AND 10000),
    amount_fen INTEGER NOT NULL CHECK (amount_fen > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'closed', 'expired', 'failed')),
    code_url TEXT,
    transaction_id VARCHAR(64) UNIQUE,
    notify_event_id VARCHAR(64) UNIQUE,
    request_id VARCHAR(128),
    failure_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wechat_creation_point_orders_user_status_created
    ON wechat_creation_point_orders(user_id, status, created_at DESC);

ALTER TABLE credit_transactions
    ADD COLUMN IF NOT EXISTS payment_order_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_payment_order
    ON credit_transactions(payment_order_id)
    WHERE payment_order_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_credit_transactions_wechat_creation_point_order'
    ) THEN
        ALTER TABLE credit_transactions
            ADD CONSTRAINT fk_credit_transactions_wechat_creation_point_order
            FOREIGN KEY (payment_order_id)
            REFERENCES wechat_creation_point_orders(payment_order_id)
            ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON TABLE wechat_creation_point_orders IS
    'WeChat Native payment orders; paid orders credit permanent account creation points exactly once';
COMMENT ON COLUMN wechat_creation_point_orders.discount_bps IS
    'Whole-order discount in basis points: 10000=full price, 8000=20 percent off';

-- Creation-point buckets, daily gifts, and phone-registration onboarding.


ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS account_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS gift_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS frozen_account_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS frozen_gift_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS gift_expires_at TIMESTAMPTZ;

-- Existing balances are permanent account points. Do not reinterpret historical
-- balances as expiring gifts.
UPDATE credit_accounts
SET account_credits = available_credits,
    frozen_account_credits = frozen_credits
WHERE account_credits = 0
  AND gift_credits = 0
  AND frozen_account_credits = 0
  AND frozen_gift_credits = 0
  AND (available_credits <> 0 OR frozen_credits <> 0);

ALTER TABLE credit_freezes ADD COLUMN IF NOT EXISTS account_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_freezes ADD COLUMN IF NOT EXISTS gift_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credit_freezes ADD COLUMN IF NOT EXISTS gift_expires_at TIMESTAMPTZ;

UPDATE credit_freezes
SET account_amount = amount
WHERE account_amount = 0 AND gift_amount = 0 AND amount > 0;

CREATE TABLE IF NOT EXISTS daily_creation_point_grants (
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    grant_date DATE NOT NULL,
    amount INTEGER NOT NULL CHECK (amount BETWEEN 10 AND 50),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, grant_date)
);

-- Replace the old 1,000-credit onboarding trigger. Only phone-verified public
-- registrations receive 200 permanent account points; legacy/admin-created rows
-- keep their existing balances and are not treated as public registrations.
CREATE OR REPLACE FUNCTION initialize_new_user_credit_account()
RETURNS TRIGGER AS $$
DECLARE
    generated_account_id VARCHAR(50);
    initial_points INTEGER := CASE WHEN COALESCE(NEW.phone_verified, FALSE) THEN 200 ELSE 0 END;
BEGIN
    generated_account_id := 'acct_' || substr(md5(random()::text || clock_timestamp()::text || NEW.user_id), 1, 16);

    INSERT INTO credit_accounts (
        account_id, owner_type, owner_id, available_credits, account_credits
    )
    VALUES (generated_account_id, 'user', NEW.user_id, initial_points, initial_points)
    ON CONFLICT (owner_type, owner_id) DO NOTHING;

    IF initial_points > 0 THEN
        INSERT INTO credit_transactions (
            transaction_id, account_id, user_id, change_type, amount,
            balance_before, balance_after, metadata
        )
        SELECT
            'txn_' || substr(md5(random()::text || clock_timestamp()::text || NEW.user_id), 1, 16),
            ca.account_id,
            NEW.user_id,
            'signup_grant',
            initial_points,
            0,
            initial_points,
            jsonb_build_object(
                'source', 'phone_registration',
                'point_bucket', 'account',
                'grant_type', 'registration',
                'initial_points', initial_points
            )
        FROM credit_accounts ca
        WHERE ca.owner_type = 'user' AND ca.owner_id = NEW.user_id
          AND NOT EXISTS (
              SELECT 1 FROM credit_transactions ct
              WHERE ct.account_id = ca.account_id
                AND ct.metadata->>'grant_type' = 'registration'
          );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN credit_accounts.account_credits IS 'Permanent account creation points currently available';
COMMENT ON COLUMN credit_accounts.gift_credits IS 'Expiring promotional creation points currently available';
COMMENT ON COLUMN credit_accounts.gift_expires_at IS 'Expiry of the current gift bucket; Asia/Shanghai daily gifts expire at 23:59:50';

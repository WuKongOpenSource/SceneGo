-- Credit account onboarding
-- Every user receives one credit account and a one-time 1000-credit grant.

CREATE OR REPLACE FUNCTION initialize_new_user_credit_account()
RETURNS TRIGGER AS $$
DECLARE
    initial_credits CONSTANT INTEGER := 1000;
    generated_account_id VARCHAR(50);
    inserted_account_id VARCHAR(50);
BEGIN
    generated_account_id := 'acct_' || substr(
        md5(random()::text || clock_timestamp()::text || NEW.user_id),
        1,
        16
    );

    INSERT INTO credit_accounts (
        account_id, owner_type, owner_id, available_credits
    ) VALUES (
        generated_account_id, 'user', NEW.user_id, initial_credits
    )
    ON CONFLICT (owner_type, owner_id) DO NOTHING
    RETURNING account_id INTO inserted_account_id;

    IF inserted_account_id IS NOT NULL THEN
        INSERT INTO credit_transactions (
            transaction_id, account_id, user_id, change_type, amount,
            balance_before, balance_after, metadata
        ) VALUES (
            'txn_' || substr(
                md5(random()::text || clock_timestamp()::text || NEW.user_id),
                1,
                16
            ),
            inserted_account_id,
            NEW.user_id,
            'signup_grant',
            initial_credits,
            0,
            initial_credits,
            jsonb_build_object(
                'source', 'user_onboarding',
                'grant_type', 'initial_credit',
                'initial_credits', initial_credits
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_users_initialize_credit_account'
          AND tgrelid = 'users'::regclass
          AND NOT tgisinternal
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_users_initialize_credit_account '
             || 'AFTER INSERT ON users FOR EACH ROW '
             || 'EXECUTE FUNCTION initialize_new_user_credit_account()';
    END IF;
END;
$$;

-- Backfill active users that predate the onboarding trigger. Some users already
-- have a zero-balance account created lazily by the DAO, so account existence is
-- not a reliable idempotency marker. The signup_grant transaction is.
DO $$
DECLARE
    initial_credits CONSTANT INTEGER := 1000;
    user_row RECORD;
    generated_account_id VARCHAR(50);
    target_account_id VARCHAR(50);
    balance_before_value INTEGER;
    balance_after_value INTEGER;
BEGIN
    FOR user_row IN
        SELECT u.user_id
        FROM users u
        WHERE COALESCE(u.is_active, TRUE) = TRUE
          AND NOT EXISTS (
              SELECT 1
              FROM credit_transactions ct
              JOIN credit_accounts ca ON ca.account_id = ct.account_id
              WHERE ca.owner_type = 'user'
                AND ca.owner_id = u.user_id
                AND ct.change_type = 'signup_grant'
          )
        ORDER BY u.created_at, u.user_id
    LOOP
        generated_account_id := 'acct_' || substr(
            md5(random()::text || clock_timestamp()::text || user_row.user_id),
            1,
            16
        );
        target_account_id := NULL;

        INSERT INTO credit_accounts (
            account_id, owner_type, owner_id, available_credits
        ) VALUES (
            generated_account_id, 'user', user_row.user_id, 0
        )
        ON CONFLICT (owner_type, owner_id) DO NOTHING
        RETURNING account_id INTO target_account_id;

        IF target_account_id IS NULL THEN
            SELECT account_id
            INTO target_account_id
            FROM credit_accounts
            WHERE owner_type = 'user'
              AND owner_id = user_row.user_id
            FOR UPDATE;
        END IF;

        IF target_account_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM credit_transactions
            WHERE account_id = target_account_id
              AND change_type = 'signup_grant'
        ) THEN
            SELECT available_credits
            INTO balance_before_value
            FROM credit_accounts
            WHERE account_id = target_account_id
            FOR UPDATE;

            UPDATE credit_accounts
            SET available_credits = available_credits + initial_credits,
                updated_at = CURRENT_TIMESTAMP
            WHERE account_id = target_account_id
            RETURNING available_credits INTO balance_after_value;

            INSERT INTO credit_transactions (
                transaction_id, account_id, user_id, change_type, amount,
                balance_before, balance_after, metadata
            ) VALUES (
                'txn_' || substr(
                    md5(random()::text || clock_timestamp()::text || user_row.user_id),
                    1,
                    16
                ),
                target_account_id,
                user_row.user_id,
                'signup_grant',
                initial_credits,
                balance_before_value,
                balance_after_value,
                jsonb_build_object(
                    'source', 'credit_onboarding_backfill',
                    'grant_type', 'initial_credit',
                    'initial_credits', initial_credits
                )
            );
        END IF;
    END LOOP;
END;
$$;

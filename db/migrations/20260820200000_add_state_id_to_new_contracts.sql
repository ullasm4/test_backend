-- migrate:up

-- Allow listing-only rows from state-wise GeM HTML scrape (seller/buyer filled later via PDF).
ALTER TABLE new_contracts
    ALTER COLUMN seller_id DROP NOT NULL,
    ALTER COLUMN buyer_id DROP NOT NULL,
    ALTER COLUMN ministry_id DROP NOT NULL;

ALTER TABLE new_contracts
    ADD COLUMN IF NOT EXISTS state_id UUID REFERENCES states(id);

CREATE INDEX IF NOT EXISTS idx_new_contracts_state_id
    ON new_contracts (state_id);

CREATE INDEX IF NOT EXISTS idx_new_contracts_state_date
    ON new_contracts (state_id, contract_date DESC NULLS LAST, created_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_state_date;
DROP INDEX IF EXISTS idx_new_contracts_state_id;

ALTER TABLE new_contracts
    DROP COLUMN IF EXISTS state_id;

-- Re-apply NOT NULL only when no nulls remain (safe rollback for empty/null rows).
DELETE FROM new_contracts
WHERE seller_id IS NULL OR buyer_id IS NULL OR ministry_id IS NULL;

ALTER TABLE new_contracts
    ALTER COLUMN seller_id SET NOT NULL,
    ALTER COLUMN buyer_id SET NOT NULL,
    ALTER COLUMN ministry_id SET NOT NULL;

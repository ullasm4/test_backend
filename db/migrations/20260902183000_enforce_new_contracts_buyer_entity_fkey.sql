-- migrate:up
-- Links new_contracts → buyer_entities (buyer-entity-wise GeM listing scrape).
-- Safe to run even if 20260902181000 was already applied.

ALTER TABLE new_contracts
    ADD COLUMN IF NOT EXISTS buyer_entity_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'new_contracts_buyer_entity_id_fkey'
    ) THEN
        ALTER TABLE new_contracts
            ADD CONSTRAINT new_contracts_buyer_entity_id_fkey
            FOREIGN KEY (buyer_entity_id)
            REFERENCES buyer_entities(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_new_contracts_buyer_entity_id
    ON new_contracts (buyer_entity_id);

CREATE INDEX IF NOT EXISTS idx_new_contracts_buyer_entity_date
    ON new_contracts (buyer_entity_id, contract_date DESC NULLS LAST, created_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_buyer_entity_date;

DROP INDEX IF EXISTS idx_new_contracts_buyer_entity_id;

ALTER TABLE new_contracts
    DROP CONSTRAINT IF EXISTS new_contracts_buyer_entity_id_fkey;

ALTER TABLE new_contracts
    DROP COLUMN IF EXISTS buyer_entity_id;

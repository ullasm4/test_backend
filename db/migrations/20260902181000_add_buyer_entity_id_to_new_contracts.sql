-- migrate:up

ALTER TABLE new_contracts
    ADD COLUMN IF NOT EXISTS buyer_entity_id UUID REFERENCES buyer_entities(id);

CREATE INDEX IF NOT EXISTS idx_new_contracts_buyer_entity_id
    ON new_contracts (buyer_entity_id);

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_buyer_entity_id;

ALTER TABLE new_contracts
    DROP COLUMN IF EXISTS buyer_entity_id;

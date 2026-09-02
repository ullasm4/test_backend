-- migrate:up

ALTER TABLE buyer_entity_wise_contract_lists
    ADD COLUMN IF NOT EXISTS listing_complete BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_buyer_entity_wise_contract_lists_listing_complete
    ON buyer_entity_wise_contract_lists (listing_complete);

-- migrate:down

DROP INDEX IF EXISTS idx_buyer_entity_wise_contract_lists_listing_complete;

ALTER TABLE buyer_entity_wise_contract_lists
    DROP COLUMN IF EXISTS listing_complete;

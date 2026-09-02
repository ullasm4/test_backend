-- migrate:up

CREATE TABLE IF NOT EXISTS buyer_entity_wise_contract_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_entity_id UUID NOT NULL REFERENCES buyer_entities(id),
    total_pages INTEGER NOT NULL DEFAULT 0,
    total_contracts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_entity_wise_contract_lists_entity_id
    ON buyer_entity_wise_contract_lists (buyer_entity_id);

CREATE TABLE IF NOT EXISTS buyer_entity_wise_contract_list_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_entity_wise_contract_list_id UUID NOT NULL
        REFERENCES buyer_entity_wise_contract_lists(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    page_number INTEGER NOT NULL,
    total_contracts INTEGER NOT NULL DEFAULT 0,
    is_scraped BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_entity_wise_contract_list_pages_list_dates_page
    ON buyer_entity_wise_contract_list_pages (
        buyer_entity_wise_contract_list_id, from_date, to_date, page_number
    );

CREATE INDEX IF NOT EXISTS idx_buyer_entity_wise_contract_list_pages_dates
    ON buyer_entity_wise_contract_list_pages (from_date, to_date);

CREATE INDEX IF NOT EXISTS idx_buyer_entity_wise_contract_list_pages_is_scraped
    ON buyer_entity_wise_contract_list_pages (is_scraped);

-- migrate:down

DROP TABLE IF EXISTS buyer_entity_wise_contract_list_pages;
DROP TABLE IF EXISTS buyer_entity_wise_contract_lists;

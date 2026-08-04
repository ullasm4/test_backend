-- migrate:up

CREATE TABLE IF NOT EXISTS contract_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    total_contracts INTEGER NOT NULL DEFAULT 0,
    is_scrapped BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_lists_name_dates
    ON contract_lists (name, from_date, to_date);

CREATE INDEX IF NOT EXISTS idx_contract_lists_from_date
    ON contract_lists (from_date DESC);

CREATE INDEX IF NOT EXISTS idx_contract_lists_is_scrapped
    ON contract_lists (is_scrapped);

-- migrate:down

DROP TABLE IF EXISTS contract_lists;

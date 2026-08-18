-- migrate:up

CREATE TABLE IF NOT EXISTS contract_list_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    page INTEGER NOT NULL,
    total_contracts INTEGER NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NOT NULL
);

-- migrate:down

DROP TABLE IF EXISTS contract_list_data;
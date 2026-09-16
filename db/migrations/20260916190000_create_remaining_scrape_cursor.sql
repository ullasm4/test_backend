-- migrate:up

CREATE TABLE IF NOT EXISTS public.remaining_scrape_cursor (
    scope text PRIMARY KEY,
    last_contract_number text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- migrate:down

DROP TABLE IF EXISTS public.remaining_scrape_cursor;

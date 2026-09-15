-- migrate:up

CREATE TABLE IF NOT EXISTS public.not_found_contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_number text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Safe if an earlier incomplete version of this migration already created the table
ALTER TABLE public.not_found_contracts
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One row per contract number (scraper upserts on GeM miss)
CREATE UNIQUE INDEX IF NOT EXISTS not_found_contracts_contract_number_uidx
    ON public.not_found_contracts (contract_number);

CREATE INDEX IF NOT EXISTS not_found_contracts_created_at_idx
    ON public.not_found_contracts (created_at);

-- migrate:down

DROP INDEX IF EXISTS public.not_found_contracts_created_at_idx;
DROP INDEX IF EXISTS public.not_found_contracts_contract_number_uidx;
DROP TABLE IF EXISTS public.not_found_contracts;

-- migrate:up

-- Composite indexes for contracts list query sorting & filtering
CREATE INDEX IF NOT EXISTS idx_contracts_date_created ON contracts (contract_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_min_date_created ON contracts (ministry_id, contract_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status_date ON contracts (status_of_the_contract, contract_date DESC NULLS LAST);

-- migrate:down

DROP INDEX IF EXISTS idx_contracts_status_date;
DROP INDEX IF EXISTS idx_contracts_min_date_created;
DROP INDEX IF EXISTS idx_contracts_date_created;

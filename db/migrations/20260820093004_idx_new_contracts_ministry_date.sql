-- migrate:up transaction:false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_contracts_ministry_date
  ON new_contracts (ministry_id, contract_date DESC NULLS LAST, created_at DESC);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS idx_new_contracts_ministry_date;

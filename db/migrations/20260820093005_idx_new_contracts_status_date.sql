-- migrate:up transaction:false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_contracts_status_date
  ON new_contracts (status_of_the_contract, contract_date DESC NULLS LAST, created_at DESC);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS idx_new_contracts_status_date;

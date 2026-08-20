-- migrate:up transaction:false

DROP INDEX CONCURRENTLY IF EXISTS idx_new_contracts_bid_number_present;

-- migrate:down transaction:false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_contracts_bid_number_present
  ON new_contracts (id)
  WHERE bid_number IS NOT NULL AND BTRIM(bid_number) != '';

-- migrate:up transaction:false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_contracts_bid_present_value
  ON new_contracts (total_value DESC NULLS LAST, created_at DESC)
  WHERE contract_bid_number_present(bid_number);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS idx_new_contracts_bid_present_value;

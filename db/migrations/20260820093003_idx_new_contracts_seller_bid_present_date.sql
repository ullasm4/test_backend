-- migrate:up transaction:false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_contracts_seller_bid_present_date
  ON new_contracts (seller_id, contract_date DESC NULLS LAST, created_at DESC)
  WHERE contract_bid_number_present(bid_number);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS idx_new_contracts_seller_bid_present_date;

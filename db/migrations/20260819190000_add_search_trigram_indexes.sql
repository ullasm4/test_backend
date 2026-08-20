-- migrate:up

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_office_zone
  ON new_contracts USING gin (office_zone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_order_id
  ON new_contracts USING gin (order_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_bid_number
  ON new_contracts USING gin (bid_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_org_type
  ON new_contracts USING gin (org_type gin_trgm_ops);

DROP INDEX IF EXISTS idx_new_contracts_bid_number_null;

CREATE INDEX IF NOT EXISTS idx_new_contracts_bid_number_present
  ON new_contracts (id)
  WHERE bid_number IS NOT NULL AND BTRIM(bid_number) != '';

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_bid_number_present;
DROP INDEX IF EXISTS idx_gin_new_contracts_org_type;
DROP INDEX IF EXISTS idx_gin_new_contracts_bid_number;
DROP INDEX IF EXISTS idx_gin_new_contracts_order_id;
DROP INDEX IF EXISTS idx_gin_new_contracts_office_zone;

CREATE INDEX IF NOT EXISTS idx_new_contracts_bid_number_null
  ON new_contracts (id)
  WHERE bid_number IS NULL OR BTRIM(bid_number) = '';

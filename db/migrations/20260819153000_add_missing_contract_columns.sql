-- migrate:up

ALTER TABLE new_contracts
  ADD COLUMN IF NOT EXISTS bid_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS buyer_designation VARCHAR(255),
  ADD COLUMN IF NOT EXISTS buying_mode VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_new_contracts_bid_number_null
  ON new_contracts (id)
  WHERE bid_number IS NULL OR BTRIM(bid_number) = '';

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_bid_number_null;
ALTER TABLE new_contracts
  DROP COLUMN IF EXISTS buying_mode,
  DROP COLUMN IF EXISTS buyer_designation,
  DROP COLUMN IF EXISTS bid_number;

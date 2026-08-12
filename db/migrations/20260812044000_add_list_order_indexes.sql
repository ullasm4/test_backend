-- migrate:up

-- Fast default list ORDER BY (avoid seq-scan + sort on ~1M rows)
CREATE INDEX IF NOT EXISTS idx_contracts_list_date
  ON contracts (contract_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contracts_ministry_list_date
  ON contracts (ministry_id, contract_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sellers_created_at
  ON sellers (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_buyers_created_at
  ON buyers (created_at DESC);

-- Filtered list helpers (phone/email toggles)
CREATE INDEX IF NOT EXISTS idx_sellers_mobile_created
  ON sellers (created_at DESC) WHERE is_mobile = true;

CREATE INDEX IF NOT EXISTS idx_sellers_email_created
  ON sellers (created_at DESC) WHERE is_email = true;

CREATE INDEX IF NOT EXISTS idx_buyers_mobile_created
  ON buyers (created_at DESC) WHERE is_mobile = true;

CREATE INDEX IF NOT EXISTS idx_buyers_email_created
  ON buyers (created_at DESC) WHERE is_email = true;

-- migrate:down

DROP INDEX IF EXISTS idx_buyers_email_created;
DROP INDEX IF EXISTS idx_buyers_mobile_created;
DROP INDEX IF EXISTS idx_sellers_email_created;
DROP INDEX IF EXISTS idx_sellers_mobile_created;
DROP INDEX IF EXISTS idx_buyers_created_at;
DROP INDEX IF EXISTS idx_sellers_created_at;
DROP INDEX IF EXISTS idx_contracts_ministry_list_date;
DROP INDEX IF EXISTS idx_contracts_list_date;

-- migrate:up

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_date DATE;

CREATE INDEX IF NOT EXISTS idx_contracts_contract_date
  ON contracts (contract_date);

-- Backfill from GeM HTML: "Contract Date: <span>25/5/2025 10:15</span>"
UPDATE contracts
SET contract_date = to_date(
  (regexp_match(
    full_html,
    '<strong>\s*Contract Date\s*:\s*</strong>\s*<span[^>]*>\s*(\d{1,2}/\d{1,2}/\d{4})',
    'i'
  ))[1],
  'DD/MM/YYYY'
)
WHERE contract_date IS NULL
  AND full_html IS NOT NULL
  AND full_html ~* '<strong>\s*Contract Date\s*:\s*</strong>\s*<span[^>]*>\s*\d{1,2}/\d{1,2}/\d{4}';

-- migrate:down

DROP INDEX IF EXISTS idx_contracts_contract_date;
ALTER TABLE contracts DROP COLUMN IF EXISTS contract_date;

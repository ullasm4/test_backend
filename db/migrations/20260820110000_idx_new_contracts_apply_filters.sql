-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_buying_mode
  ON new_contracts USING gin (buying_mode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_new_contracts_buying_mode
  ON new_contracts (buying_mode);

CREATE INDEX IF NOT EXISTS idx_new_contracts_org_name
  ON new_contracts (org_name);

CREATE INDEX IF NOT EXISTS idx_new_contracts_department
  ON new_contracts (department);

CREATE INDEX IF NOT EXISTS idx_new_contracts_org_type
  ON new_contracts (org_type);

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_org_type;
DROP INDEX IF EXISTS idx_new_contracts_department;
DROP INDEX IF EXISTS idx_new_contracts_org_name;
DROP INDEX IF EXISTS idx_new_contracts_buying_mode;
DROP INDEX IF EXISTS idx_gin_new_contracts_buying_mode;

-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- new_contracts search columns
CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_contract_number
  ON new_contracts USING gin (contract_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_org_name
  ON new_contracts USING gin (org_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_department
  ON new_contracts USING gin (department gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_status
  ON new_contracts USING gin (status_of_the_contract gin_trgm_ops);

-- new_seller_details search columns
CREATE INDEX IF NOT EXISTS idx_gin_new_seller_details_seller_id
  ON new_seller_details USING gin (seller_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_seller_details_company_name
  ON new_seller_details USING gin (company_name gin_trgm_ops);

-- new_buyer_details search columns
CREATE INDEX IF NOT EXISTS idx_gin_new_buyer_details_company_name
  ON new_buyer_details USING gin (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_buyer_details_email
  ON new_buyer_details USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_buyer_details_phone
  ON new_buyer_details USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gin_new_buyer_details_gst_number
  ON new_buyer_details USING gin (gst_number gin_trgm_ops);

-- Composite sort indexes for pagination queries
CREATE INDEX IF NOT EXISTS idx_new_contracts_date_created
  ON new_contracts (contract_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_contracts_value
  ON new_buyer_details (total_contracts DESC NULLS LAST, total_value DESC NULLS LAST, company_name ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_new_seller_details_contracts_value
  ON new_seller_details (total_contracts DESC NULLS LAST, total_value DESC NULLS LAST, company_name ASC NULLS LAST);

-- Composite indexes for LATERAL JOIN in buyer/seller list queries
CREATE INDEX IF NOT EXISTS idx_new_contracts_buyer_date
  ON new_contracts (buyer_id, contract_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_new_contracts_seller_date
  ON new_contracts (seller_id, contract_date DESC NULLS LAST, created_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_new_seller_details_contracts_value;
DROP INDEX IF EXISTS idx_new_buyer_details_contracts_value;
DROP INDEX IF EXISTS idx_new_contracts_date_created;
DROP INDEX IF EXISTS idx_gin_new_buyer_details_gst_number;
DROP INDEX IF EXISTS idx_gin_new_buyer_details_phone;
DROP INDEX IF EXISTS idx_gin_new_buyer_details_email;
DROP INDEX IF EXISTS idx_gin_new_buyer_details_company_name;
DROP INDEX IF EXISTS idx_gin_new_seller_details_company_name;
DROP INDEX IF EXISTS idx_gin_new_seller_details_seller_id;
DROP INDEX IF EXISTS idx_gin_new_contracts_status;
DROP INDEX IF EXISTS idx_gin_new_contracts_department;
DROP INDEX IF EXISTS idx_gin_new_contracts_org_name;
DROP INDEX IF EXISTS idx_new_contracts_seller_date;
DROP INDEX IF EXISTS idx_new_contracts_buyer_date;
DROP INDEX IF EXISTS idx_gin_new_contracts_contract_number;

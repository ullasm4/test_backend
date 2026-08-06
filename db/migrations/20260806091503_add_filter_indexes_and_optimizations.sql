-- migrate:up

-- Enable pg_trgm for lightning-fast ILIKE pattern matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contracts indexes
CREATE INDEX IF NOT EXISTS idx_contracts_seller_id ON contracts (seller_id);
CREATE INDEX IF NOT EXISTS idx_contracts_ministry_id ON contracts (ministry_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status_of_the_contract);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_date ON contracts (contract_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_number ON contracts (contract_number);
CREATE INDEX IF NOT EXISTS idx_contracts_bid_number ON contracts (bid_number);
CREATE INDEX IF NOT EXISTS idx_contracts_order_id ON contracts (order_id);
CREATE INDEX IF NOT EXISTS idx_contracts_department ON contracts (department);

-- Composite indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_contracts_min_status_date ON contracts (ministry_id, status_of_the_contract, contract_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_date ON contracts (seller_id, contract_date DESC);

-- Trigram GIN indexes for ILIKE full-text searches
CREATE INDEX IF NOT EXISTS idx_contracts_contract_num_trgm ON contracts USING gin (contract_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_bid_num_trgm ON contracts USING gin (bid_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_order_id_trgm ON contracts USING gin (order_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_dept_trgm ON contracts USING gin (department gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_org_name_trgm ON contracts USING gin (org_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_status_trgm ON contracts USING gin (status_of_the_contract gin_trgm_ops);

-- Sellers indexes
CREATE INDEX IF NOT EXISTS idx_sellers_contract_id ON sellers (contract_id);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_id ON sellers (seller_id);
CREATE INDEX IF NOT EXISTS idx_sellers_gst_number ON sellers (gst_number);
CREATE INDEX IF NOT EXISTS idx_sellers_phone ON sellers (phone);
CREATE INDEX IF NOT EXISTS idx_sellers_email ON sellers (email);
CREATE INDEX IF NOT EXISTS idx_sellers_company_name ON sellers (company_name);
CREATE INDEX IF NOT EXISTS idx_sellers_company_name_trgm ON sellers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_gst ON sellers (seller_id, gst_number);

-- Buyers indexes
CREATE INDEX IF NOT EXISTS idx_buyers_contract_id ON buyers (contract_id);
CREATE INDEX IF NOT EXISTS idx_buyers_company_name ON buyers (company_name);
CREATE INDEX IF NOT EXISTS idx_buyers_phone ON buyers (phone);
CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers (email);
CREATE INDEX IF NOT EXISTS idx_buyers_company_name_trgm ON buyers USING gin (company_name gin_trgm_ops);

-- Ministry indexes
CREATE INDEX IF NOT EXISTS idx_ministry_name ON contract_ministry (name);
CREATE INDEX IF NOT EXISTS idx_ministry_name_trgm ON contract_ministry USING gin (name gin_trgm_ops);

-- migrate:down

DROP INDEX IF EXISTS idx_ministry_name_trgm;
DROP INDEX IF EXISTS idx_ministry_name;

DROP INDEX IF EXISTS idx_buyers_company_name_trgm;
DROP INDEX IF EXISTS idx_buyers_email;
DROP INDEX IF EXISTS idx_buyers_phone;
DROP INDEX IF EXISTS idx_buyers_company_name;
DROP INDEX IF EXISTS idx_buyers_contract_id;

DROP INDEX IF EXISTS idx_sellers_seller_gst;
DROP INDEX IF EXISTS idx_sellers_company_name_trgm;
DROP INDEX IF EXISTS idx_sellers_company_name;
DROP INDEX IF EXISTS idx_sellers_email;
DROP INDEX IF EXISTS idx_sellers_phone;
DROP INDEX IF EXISTS idx_sellers_gst_number;
DROP INDEX IF EXISTS idx_sellers_seller_id;bb
DROP INDEX IF EXISTS idx_sellers_contract_id;

DROP INDEX IF EXISTS idx_contracts_status_trgm;
DROP INDEX IF EXISTS idx_contracts_org_name_trgm;
DROP INDEX IF EXISTS idx_contracts_dept_trgm;
DROP INDEX IF EXISTS idx_contracts_order_id_trgm;
DROP INDEX IF EXISTS idx_contracts_bid_num_trgm;
DROP INDEX IF EXISTS idx_contracts_contract_num_trgm;
DROP INDEX IF EXISTS idx_contracts_seller_date;
DROP INDEX IF EXISTS idx_contracts_min_status_date;
DROP INDEX IF EXISTS idx_contracts_department;
DROP INDEX IF EXISTS idx_contracts_order_id;
DROP INDEX IF EXISTS idx_contracts_bid_number;
DROP INDEX IF EXISTS idx_contracts_contract_number;
DROP INDEX IF EXISTS idx_contracts_contract_date;
DROP INDEX IF EXISTS idx_contracts_status;
DROP INDEX IF EXISTS idx_contracts_ministry_id;
DROP INDEX IF EXISTS idx_contracts_seller_id;

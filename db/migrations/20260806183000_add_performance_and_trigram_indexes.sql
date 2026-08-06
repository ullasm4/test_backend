-- migrate:up

-- Ensure pg_trgm extension is available
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contracts additional trigram indexes
CREATE INDEX IF NOT EXISTS idx_contracts_seller_id_trgm ON contracts USING gin (seller_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_company_trgm ON contracts USING gin (seller_company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_company_trgm ON contracts USING gin (buyer_company gin_trgm_ops);

-- Sellers trigram & partial b-tree indexes
CREATE INDEX IF NOT EXISTS idx_sellers_email_trgm ON sellers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_phone_trgm ON sellers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_id_trgm ON sellers USING gin (seller_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_is_mobile ON sellers (is_mobile) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_sellers_is_email ON sellers (is_email) WHERE is_email = true;

-- Buyers trigram & partial b-tree indexes
CREATE INDEX IF NOT EXISTS idx_buyers_email_trgm ON buyers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_phone_trgm ON buyers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_gst_number_trgm ON buyers USING gin (gst_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_is_mobile ON buyers (is_mobile) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_buyers_is_email ON buyers (is_email) WHERE is_email = true;

-- migrate:down

DROP INDEX IF EXISTS idx_buyers_is_email;
DROP INDEX IF EXISTS idx_buyers_is_mobile;
DROP INDEX IF EXISTS idx_buyers_gst_number_trgm;
DROP INDEX IF EXISTS idx_buyers_phone_trgm;
DROP INDEX IF EXISTS idx_buyers_email_trgm;

DROP INDEX IF EXISTS idx_sellers_is_email;
DROP INDEX IF EXISTS idx_sellers_is_mobile;
DROP INDEX IF EXISTS idx_sellers_seller_id_trgm;
DROP INDEX IF EXISTS idx_sellers_phone_trgm;
DROP INDEX IF EXISTS idx_sellers_email_trgm;

DROP INDEX IF EXISTS idx_contracts_buyer_company_trgm;
DROP INDEX IF EXISTS idx_contracts_seller_company_trgm;
DROP INDEX IF EXISTS idx_contracts_seller_id_trgm;

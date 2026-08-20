-- migrate:up

-- Old "contracts" table indexes (API uses new_contracts instead)
DROP INDEX IF EXISTS idx_contracts_seller_id;
DROP INDEX IF EXISTS idx_contracts_ministry_id;
DROP INDEX IF EXISTS idx_contracts_status;
DROP INDEX IF EXISTS idx_contracts_contract_date;
DROP INDEX IF EXISTS idx_contracts_contract_number;
DROP INDEX IF EXISTS idx_contracts_bid_number;
DROP INDEX IF EXISTS idx_contracts_order_id;
DROP INDEX IF EXISTS idx_contracts_department;
DROP INDEX IF EXISTS idx_contracts_min_status_date;
DROP INDEX IF EXISTS idx_contracts_seller_date;
DROP INDEX IF EXISTS idx_contracts_contract_num_trgm;
DROP INDEX IF EXISTS idx_contracts_bid_num_trgm;
DROP INDEX IF EXISTS idx_contracts_order_id_trgm;
DROP INDEX IF EXISTS idx_contracts_dept_trgm;
DROP INDEX IF EXISTS idx_contracts_org_name_trgm;
DROP INDEX IF EXISTS idx_contracts_status_trgm;
DROP INDEX IF EXISTS idx_contracts_seller_id_trgm;
DROP INDEX IF EXISTS idx_contracts_seller_company_trgm;
DROP INDEX IF EXISTS idx_contracts_buyer_company_trgm;
DROP INDEX IF EXISTS idx_contracts_list_date;
DROP INDEX IF EXISTS idx_contracts_ministry_list_date;
DROP INDEX IF EXISTS idx_contracts_total_value;
DROP INDEX IF EXISTS idx_contracts_buyer_phone;
DROP INDEX IF EXISTS idx_contracts_seller_phone;
DROP INDEX IF EXISTS idx_contracts_buyer_company;
DROP INDEX IF EXISTS idx_contracts_seller_company;
DROP INDEX IF EXISTS idx_contracts_office_zone;
DROP INDEX IF EXISTS idx_contracts_org_type;
DROP INDEX IF EXISTS idx_contracts_bid_null_list;
DROP INDEX IF EXISTS idx_contracts_bid_null_value;

-- Old "sellers" table indexes (API uses new_seller_details instead)
DROP INDEX IF EXISTS idx_sellers_contract_id;
DROP INDEX IF EXISTS idx_sellers_seller_id;
DROP INDEX IF EXISTS idx_sellers_gst_number;
DROP INDEX IF EXISTS idx_sellers_phone;
DROP INDEX IF EXISTS idx_sellers_email;
DROP INDEX IF EXISTS idx_sellers_company_name;
DROP INDEX IF EXISTS idx_sellers_company_name_trgm;
DROP INDEX IF EXISTS idx_sellers_seller_gst;
DROP INDEX IF EXISTS idx_sellers_email_trgm;
DROP INDEX IF EXISTS idx_sellers_phone_trgm;
DROP INDEX IF EXISTS idx_sellers_seller_id_trgm;
DROP INDEX IF EXISTS idx_sellers_is_mobile;
DROP INDEX IF EXISTS idx_sellers_is_email;
DROP INDEX IF EXISTS idx_sellers_created_at;
DROP INDEX IF EXISTS idx_sellers_mobile_created;
DROP INDEX IF EXISTS idx_sellers_email_created;
DROP INDEX IF EXISTS idx_sellers_msme_cert;
DROP INDEX IF EXISTS idx_sellers_gst_prefix;
DROP INDEX IF EXISTS idx_sellers_gst_number_trgm;
DROP INDEX IF EXISTS idx_sellers_unique_identity_created;
DROP INDEX IF EXISTS idx_sellers_unique_phone_created;
DROP INDEX IF EXISTS idx_sellers_unique_email_created;
DROP INDEX IF EXISTS idx_sellers_unique_gst_created;

-- Old "buyers" table indexes (API uses new_buyer_details instead)
DROP INDEX IF EXISTS idx_buyers_contract_id;
DROP INDEX IF EXISTS idx_buyers_company_name;
DROP INDEX IF EXISTS idx_buyers_phone;
DROP INDEX IF EXISTS idx_buyers_email;
DROP INDEX IF EXISTS idx_buyers_company_name_trgm;
DROP INDEX IF EXISTS idx_buyers_email_trgm;
DROP INDEX IF EXISTS idx_buyers_phone_trgm;
DROP INDEX IF EXISTS idx_buyers_gst_number_trgm;
DROP INDEX IF EXISTS idx_buyers_is_mobile;
DROP INDEX IF EXISTS idx_buyers_is_email;
DROP INDEX IF EXISTS idx_buyers_created_at;
DROP INDEX IF EXISTS idx_buyers_mobile_created;
DROP INDEX IF EXISTS idx_buyers_email_created;
DROP INDEX IF EXISTS idx_buyers_unique_identity_created;
DROP INDEX IF EXISTS idx_buyers_unique_phone_created;
DROP INDEX IF EXISTS idx_buyers_unique_email_created;
DROP INDEX IF EXISTS idx_buyers_unique_gst_created;

-- migrate:down

-- contracts
CREATE INDEX IF NOT EXISTS idx_contracts_seller_id ON contracts (seller_id);
CREATE INDEX IF NOT EXISTS idx_contracts_ministry_id ON contracts (ministry_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status_of_the_contract);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_date ON contracts (contract_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_number ON contracts (contract_number);
CREATE INDEX IF NOT EXISTS idx_contracts_bid_number ON contracts (bid_number);
CREATE INDEX IF NOT EXISTS idx_contracts_order_id ON contracts (order_id);
CREATE INDEX IF NOT EXISTS idx_contracts_department ON contracts (department);
CREATE INDEX IF NOT EXISTS idx_contracts_min_status_date ON contracts (ministry_id, status_of_the_contract, contract_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_date ON contracts (seller_id, contract_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_num_trgm ON contracts USING gin (contract_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_bid_num_trgm ON contracts USING gin (bid_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_order_id_trgm ON contracts USING gin (order_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_dept_trgm ON contracts USING gin (department gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_org_name_trgm ON contracts USING gin (org_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_status_trgm ON contracts USING gin (status_of_the_contract gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_id_trgm ON contracts USING gin (seller_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_company_trgm ON contracts USING gin (seller_company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_company_trgm ON contracts USING gin (buyer_company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_list_date ON contracts (contract_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_ministry_list_date ON contracts (ministry_id, contract_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_total_value ON contracts (total_value);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_phone ON contracts (buyer_phone);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_phone ON contracts (seller_phone);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_company ON contracts (buyer_company);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_company ON contracts (seller_company);
CREATE INDEX IF NOT EXISTS idx_contracts_office_zone ON contracts (office_zone);
CREATE INDEX IF NOT EXISTS idx_contracts_org_type ON contracts (org_type);

-- sellers
CREATE INDEX IF NOT EXISTS idx_sellers_contract_id ON sellers (contract_id);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_id ON sellers (seller_id);
CREATE INDEX IF NOT EXISTS idx_sellers_gst_number ON sellers (gst_number);
CREATE INDEX IF NOT EXISTS idx_sellers_phone ON sellers (phone);
CREATE INDEX IF NOT EXISTS idx_sellers_email ON sellers (email);
CREATE INDEX IF NOT EXISTS idx_sellers_company_name ON sellers (company_name);
CREATE INDEX IF NOT EXISTS idx_sellers_company_name_trgm ON sellers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_gst ON sellers (seller_id, gst_number);
CREATE INDEX IF NOT EXISTS idx_sellers_email_trgm ON sellers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_phone_trgm ON sellers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_id_trgm ON sellers USING gin (seller_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_is_mobile ON sellers (is_mobile) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_sellers_is_email ON sellers (is_email) WHERE is_email = true;
CREATE INDEX IF NOT EXISTS idx_sellers_created_at ON sellers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sellers_mobile_created ON sellers (created_at DESC) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_sellers_email_created ON sellers (created_at DESC) WHERE is_email = true;
CREATE INDEX IF NOT EXISTS idx_sellers_msme_cert ON sellers (msme_certificate_number);
CREATE INDEX IF NOT EXISTS idx_sellers_gst_prefix ON sellers (gst_number text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_gst_number_trgm ON sellers USING gin (gst_number gin_trgm_ops);

-- buyers
CREATE INDEX IF NOT EXISTS idx_buyers_contract_id ON buyers (contract_id);
CREATE INDEX IF NOT EXISTS idx_buyers_company_name ON buyers (company_name);
CREATE INDEX IF NOT EXISTS idx_buyers_phone ON buyers (phone);
CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers (email);
CREATE INDEX IF NOT EXISTS idx_buyers_company_name_trgm ON buyers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_email_trgm ON buyers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_phone_trgm ON buyers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_gst_number_trgm ON buyers USING gin (gst_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buyers_is_mobile ON buyers (is_mobile) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_buyers_is_email ON buyers (is_email) WHERE is_email = true;
CREATE INDEX IF NOT EXISTS idx_buyers_created_at ON buyers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyers_mobile_created ON buyers (created_at DESC) WHERE is_mobile = true;
CREATE INDEX IF NOT EXISTS idx_buyers_email_created ON buyers (created_at DESC) WHERE is_email = true;

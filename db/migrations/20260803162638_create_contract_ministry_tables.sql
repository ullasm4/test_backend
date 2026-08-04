-- migrate:up

CREATE TABLE IF NOT EXISTS contract_ministry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_ministry_name
    ON contract_ministry (name);

CREATE TABLE IF NOT EXISTS contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ministry_id uuid NOT NULL REFERENCES contract_ministry(id),
    full_html TEXT,
    contract_number TEXT,
    org_type TEXT,
    org_name TEXT,
    buyer_designation TEXT,
    total_value DECIMAL(18, 2),
    bid_number TEXT,
    department TEXT,
    office_zone TEXT,
    status_of_the_contract TEXT,
    order_id TEXT,
    contract_pdf_url TEXT,
    buyer_details jsonb NOT NULL DEFAULT '{}',
    seller_details jsonb NOT NULL DEFAULT '{}',
    financial_application jsonb NOT NULL DEFAULT '{}',
    paying_authority jsonb NOT NULL DEFAULT '{}',
    products jsonb NOT NULL DEFAULT '{}',
    consinee_details jsonb NOT NULL DEFAULT '{}',
    buyer_company VARCHAR(255),
    buyer_email VARCHAR(255),
    buyer_phone VARCHAR(255),
    seller_company VARCHAR(255),
    seller_email VARCHAR(255),
    seller_phone VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contracts_ministry_id
    ON contracts (ministry_id);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_number
    ON contracts (contract_number);
CREATE INDEX IF NOT EXISTS idx_contracts_bid_number
    ON contracts (bid_number);
CREATE INDEX IF NOT EXISTS idx_contracts_order_id
    ON contracts (order_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status
    ON contracts (status_of_the_contract);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_email
    ON contracts (buyer_email);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_email
    ON contracts (seller_email);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at
    ON contracts (created_at);

CREATE TABLE IF NOT EXISTS sellers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    seller_id VARCHAR(255),
    company_name VARCHAR(255),
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    msme_certificate_number VARCHAR(255),
    gst_number VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sellers_contract_id
    ON sellers (contract_id);
CREATE INDEX IF NOT EXISTS idx_sellers_seller_id
    ON sellers (seller_id);
CREATE INDEX IF NOT EXISTS idx_sellers_email
    ON sellers (email);
CREATE INDEX IF NOT EXISTS idx_sellers_gst_number
    ON sellers (gst_number);

CREATE TABLE IF NOT EXISTS buyers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    company_name VARCHAR(255),
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    gst_number VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_buyers_contract_id
    ON buyers (contract_id);
CREATE INDEX IF NOT EXISTS idx_buyers_email
    ON buyers (email);
CREATE INDEX IF NOT EXISTS idx_buyers_gst_number
    ON buyers (gst_number);

-- migrate:down

DROP TABLE IF EXISTS buyers;
DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS contract_ministry;

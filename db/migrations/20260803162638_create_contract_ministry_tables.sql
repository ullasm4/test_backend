-- migrate:up

CREATE TABLE IF NOT EXISTS contract_ministry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
);

CREATE TABLE IF NOT EXISTS contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ministry_id uuid NOT NULL REFERENCES contract_ministry(id),
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
);

CREATE TABLE IF NOT EXISTS sellers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    seller_id VARCHAR(255),
    company_name VARCHAR(255),
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    msme_certificate_number VARCHAR(255),
    gst_number VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
);

CREATE TABLE IF NOT EXISTS buyers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255),
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    gst_number VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
);

-- migrate:down

DROP TABLE IF EXISTS contract_ministry;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS buyers;
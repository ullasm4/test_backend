-- migrate:up

CREATE TABLE IF NOT EXISTS new_seller_details (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    msme_certificate_number VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_new_seller_details_seller_id
    ON new_seller_details (seller_id);

CREATE TABLE IF NOT EXISTS new_seller_information (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL,
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    gst_number VARCHAR(255),
    CONSTRAINT fk_new_seller_information_seller_id
        FOREIGN KEY (seller_id) REFERENCES new_seller_details(id) ,
    CONSTRAINT uk_new_seller_information_seller_phone_email
        UNIQUE (seller_id, phone, email)
);

CREATE INDEX IF NOT EXISTS idx_new_seller_information_seller_id
    ON new_seller_information (seller_id);
CREATE INDEX IF NOT EXISTS idx_new_seller_information_email
    ON new_seller_information (email);
CREATE INDEX IF NOT EXISTS idx_new_seller_information_gst_number
    ON new_seller_information (gst_number);

CREATE TABLE IF NOT EXISTS new_buyer_details (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255),
    phone VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    gst_number VARCHAR(255),

    CONSTRAINT uk_new_buyer_details_company_phone_email
        UNIQUE (company_name, phone, email)
);

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_email
    ON new_buyer_details (email);
CREATE INDEX IF NOT EXISTS idx_new_buyer_details_gst_number
    ON new_buyer_details (gst_number);
CREATE INDEX IF NOT EXISTS idx_new_buyer_details_phone
    ON new_buyer_details (phone);

CREATE TABLE IF NOT EXISTS new_contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    ministry_id uuid NOT NULL,
    contract_number TEXT,
    org_type TEXT,
    org_name TEXT,
    total_value DECIMAL(18, 2),
    department TEXT,
    office_zone TEXT,
    status_of_the_contract TEXT,
    order_id TEXT,
    contract_pdf_url TEXT,
    financial_application jsonb NOT NULL DEFAULT '{}',
    paying_authority jsonb NOT NULL DEFAULT '{}',
    products jsonb NOT NULL DEFAULT '{}',
    consinee_details jsonb NOT NULL DEFAULT '{}',
    contract_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_new_contracts_seller_id
        FOREIGN KEY (seller_id) REFERENCES new_seller_details(id),
    CONSTRAINT fk_new_contracts_buyer_id
        FOREIGN KEY (buyer_id) REFERENCES new_buyer_details(id),
    CONSTRAINT fk_new_contracts_ministry_id
        FOREIGN KEY (ministry_id) REFERENCES contract_ministry(id)
);

CREATE INDEX IF NOT EXISTS idx_new_contracts_seller_id
    ON new_contracts (seller_id);
CREATE INDEX IF NOT EXISTS idx_new_contracts_buyer_id
    ON new_contracts (buyer_id);
CREATE INDEX IF NOT EXISTS idx_new_contracts_ministry_id
    ON new_contracts (ministry_id);
CREATE INDEX IF NOT EXISTS idx_new_contracts_contract_number
    ON new_contracts (contract_number);
CREATE INDEX IF NOT EXISTS idx_new_contracts_order_id
    ON new_contracts (order_id);
CREATE INDEX IF NOT EXISTS idx_new_contracts_status
    ON new_contracts (status_of_the_contract);
CREATE INDEX IF NOT EXISTS idx_new_contracts_contract_date
    ON new_contracts (contract_date);
CREATE INDEX IF NOT EXISTS idx_new_contracts_created_at
    ON new_contracts (created_at);

-- migrate:down

DROP TABLE IF EXISTS new_contracts;
DROP TABLE IF EXISTS new_buyer_details;
DROP TABLE IF EXISTS new_seller_information;
DROP TABLE IF EXISTS new_seller_details;

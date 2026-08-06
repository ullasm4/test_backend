-- migrate:up

CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    gst_code VARCHAR(2)
);

ALTER TABLE states
ADD COLUMN IF NOT EXISTS gst_code VARCHAR(2);

-- Populate states data
INSERT INTO states (name, gst_code)
VALUES
    ('Jammu and Kashmir', '01'),
    ('Himachal Pradesh', '02'),
    ('Punjab', '03'),
    ('Chandigarh', '04'),
    ('Uttarakhand', '05'),
    ('Haryana', '06'),
    ('Delhi', '07'),
    ('Rajasthan', '08'),
    ('Uttar Pradesh', '09'),
    ('Bihar', '10'),
    ('Sikkim', '11'),
    ('Arunachal Pradesh', '12'),
    ('Nagaland', '13'),
    ('Manipur', '14'),
    ('Mizoram', '15'),
    ('Tripura', '16'),
    ('Meghalaya', '17'),
    ('Assam', '18'),
    ('West Bengal', '19'),
    ('Jharkhand', '20'),
    ('Odisha', '21'),
    ('Chhattisgarh', '22'),
    ('Madhya Pradesh', '23'),
    ('Gujarat', '24'),
    ('Dadra and Nagar Haveli and Daman and Diu', '26'),
    ('Maharashtra', '27'),
    ('Andhra Pradesh', '28'),
    ('Karnataka', '29'),
    ('Goa', '30'),
    ('Lakshadweep', '31'),
    ('Kerala', '32'),
    ('Tamil Nadu', '33'),
    ('Puducherry', '34'),
    ('Andaman and Nicobar Islands', '35'),
    ('Telangana', '36'),
    ('Andhra Pradesh (Old)', '37'),
    ('Ladakh', '38')
ON CONFLICT DO NOTHING;

UPDATE states
SET gst_code = CASE LOWER(name)
    WHEN 'jammu and kashmir' THEN '01'
    WHEN 'himachal pradesh' THEN '02'
    WHEN 'punjab' THEN '03'
    WHEN 'chandigarh' THEN '04'
    WHEN 'uttarakhand' THEN '05'
    WHEN 'haryana' THEN '06'
    WHEN 'delhi' THEN '07'
    WHEN 'rajasthan' THEN '08'
    WHEN 'uttar pradesh' THEN '09'
    WHEN 'bihar' THEN '10'
    WHEN 'sikkim' THEN '11'
    WHEN 'arunachal pradesh' THEN '12'
    WHEN 'nagaland' THEN '13'
    WHEN 'manipur' THEN '14'
    WHEN 'mizoram' THEN '15'
    WHEN 'tripura' THEN '16'
    WHEN 'meghalaya' THEN '17'
    WHEN 'assam' THEN '18'
    WHEN 'west bengal' THEN '19'
    WHEN 'jharkhand' THEN '20'
    WHEN 'odisha' THEN '21'
    WHEN 'chhattisgarh' THEN '22'
    WHEN 'madhya pradesh' THEN '23'
    WHEN 'gujarat' THEN '24'
    WHEN 'dadra and nagar haveli and daman and diu' THEN '26'
    WHEN 'maharashtra' THEN '27'
    WHEN 'andhra pradesh' THEN '28'
    WHEN 'karnataka' THEN '29'
    WHEN 'goa' THEN '30'
    WHEN 'lakshadweep' THEN '31'
    WHEN 'kerala' THEN '32'
    WHEN 'tamil nadu' THEN '33'
    WHEN 'puducherry' THEN '34'
    WHEN 'andaman and nicobar islands' THEN '35'
    WHEN 'telangana' THEN '36'
    WHEN 'andhra pradesh (old)' THEN '37'
    WHEN 'ladakh' THEN '38'
    ELSE gst_code
END;

-- Performance Optimization: Additional Indexes across tables

-- States Indexes
CREATE INDEX IF NOT EXISTS idx_states_name ON states (name);
CREATE INDEX IF NOT EXISTS idx_states_gst_code ON states (gst_code);

-- Contracts Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_phone ON contracts (buyer_phone);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_phone ON contracts (seller_phone);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_company ON contracts (buyer_company);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_company ON contracts (seller_company);
CREATE INDEX IF NOT EXISTS idx_contracts_office_zone ON contracts (office_zone);
CREATE INDEX IF NOT EXISTS idx_contracts_org_type ON contracts (org_type);
CREATE INDEX IF NOT EXISTS idx_contracts_total_value ON contracts (total_value);

-- Sellers Indexes
CREATE INDEX IF NOT EXISTS idx_sellers_msme_cert ON sellers (msme_certificate_number);

-- Users Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- migrate:down

DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_phone;
DROP INDEX IF EXISTS idx_users_email;

DROP INDEX IF EXISTS idx_sellers_msme_cert;

DROP INDEX IF EXISTS idx_contracts_total_value;
DROP INDEX IF EXISTS idx_contracts_org_type;
DROP INDEX IF EXISTS idx_contracts_office_zone;
DROP INDEX IF EXISTS idx_contracts_seller_company;
DROP INDEX IF EXISTS idx_contracts_buyer_company;
DROP INDEX IF EXISTS idx_contracts_seller_phone;
DROP INDEX IF EXISTS idx_contracts_buyer_phone;

DROP INDEX IF EXISTS idx_states_gst_code;
DROP INDEX IF EXISTS idx_states_name;

ALTER TABLE states DROP COLUMN IF EXISTS gst_code;

DROP TABLE IF EXISTS states;

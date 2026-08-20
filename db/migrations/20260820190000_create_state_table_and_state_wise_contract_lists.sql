-- migrate:up

-- Rebuild states with UUID id (old table used SERIAL integer id).
DROP TABLE IF EXISTS state_wise_contract_list_pages;
DROP TABLE IF EXISTS state_wise_contract_lists;
DROP TABLE IF EXISTS states CASCADE;
DROP SEQUENCE IF EXISTS states_id_seq;

CREATE TABLE IF NOT EXISTS states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    gst_code VARCHAR(2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
    ('Ladakh', '38');

CREATE UNIQUE INDEX IF NOT EXISTS idx_states_name ON states (name);
CREATE INDEX IF NOT EXISTS idx_states_gst_code ON states (gst_code);

CREATE TABLE IF NOT EXISTS state_wise_contract_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id),
    total_pages INTEGER NOT NULL DEFAULT 0,
    total_contracts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_state_wise_contract_lists_state_id
    ON state_wise_contract_lists (state_id);

CREATE TABLE IF NOT EXISTS state_wise_contract_list_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_wise_contract_list_id UUID NOT NULL REFERENCES state_wise_contract_lists(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    page_number INTEGER NOT NULL,
    total_contracts INTEGER NOT NULL DEFAULT 0,
    is_scraped BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_state_wise_contract_list_pages_list_dates_page
    ON state_wise_contract_list_pages (state_wise_contract_list_id, from_date, to_date, page_number);

CREATE INDEX IF NOT EXISTS idx_state_wise_contract_list_pages_dates
    ON state_wise_contract_list_pages (from_date, to_date);

CREATE INDEX IF NOT EXISTS idx_state_wise_contract_list_pages_is_scraped
    ON state_wise_contract_list_pages (is_scraped);

-- migrate:down

DROP TABLE IF EXISTS state_wise_contract_list_pages;
DROP TABLE IF EXISTS state_wise_contract_lists;

DROP TABLE IF EXISTS states CASCADE;
DROP SEQUENCE IF EXISTS states_id_seq;

CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    gst_code VARCHAR(2)
);

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
    ('Ladakh', '38');

CREATE INDEX IF NOT EXISTS idx_states_name ON states (name);
CREATE INDEX IF NOT EXISTS idx_states_gst_code ON states (gst_code);

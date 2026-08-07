-- migrate:up

CREATE TABLE IF NOT EXISTS total_counts (
    id INT PRIMARY KEY DEFAULT 1,
    total_contracts INT NOT NULL DEFAULT 0,
    total_sellers INT NOT NULL DEFAULT 0,
    total_buyers INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_row_check CHECK (id = 1)
);

-- Seed initial counts from existing tables
INSERT INTO total_counts (id, total_contracts, total_sellers, total_buyers)
VALUES (
    1,
    (SELECT COUNT(*)::int FROM contracts),
    (SELECT COUNT(*)::int FROM sellers),
    (SELECT COUNT(*)::int FROM buyers)
)
ON CONFLICT (id) DO UPDATE SET
    total_contracts = EXCLUDED.total_contracts,
    total_sellers = EXCLUDED.total_sellers,
    total_buyers = EXCLUDED.total_buyers,
    updated_at = CURRENT_TIMESTAMP;

-- Triggers for contracts table
CREATE OR REPLACE FUNCTION update_total_contracts_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_contracts = total_contracts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_contracts = GREATEST(0, total_contracts - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_contracts_count ON contracts;
CREATE TRIGGER trigger_update_total_contracts_count
AFTER INSERT OR DELETE ON contracts
FOR EACH ROW
EXECUTE FUNCTION update_total_contracts_count();

-- Triggers for sellers table
CREATE OR REPLACE FUNCTION update_total_sellers_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_sellers = total_sellers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_sellers = GREATEST(0, total_sellers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_sellers_count ON sellers;
CREATE TRIGGER trigger_update_total_sellers_count
AFTER INSERT OR DELETE ON sellers
FOR EACH ROW
EXECUTE FUNCTION update_total_sellers_count();

-- Triggers for buyers table
CREATE OR REPLACE FUNCTION update_total_buyers_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_buyers = total_buyers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_buyers = GREATEST(0, total_buyers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_buyers_count ON buyers;
CREATE TRIGGER trigger_update_total_buyers_count
AFTER INSERT OR DELETE ON buyers
FOR EACH ROW
EXECUTE FUNCTION update_total_buyers_count();

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_total_buyers_count ON buyers;
DROP FUNCTION IF EXISTS update_total_buyers_count();

DROP TRIGGER IF EXISTS trigger_update_total_sellers_count ON sellers;
DROP FUNCTION IF EXISTS update_total_sellers_count();

DROP TRIGGER IF EXISTS trigger_update_total_contracts_count ON contracts;
DROP FUNCTION IF EXISTS update_total_contracts_count();

DROP TABLE IF EXISTS total_counts;
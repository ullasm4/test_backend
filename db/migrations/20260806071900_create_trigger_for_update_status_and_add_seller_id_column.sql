-- migrate:up

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS seller_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_contracts_seller_id ON contracts (seller_id);

-- Create trigger function to set is_mobile and is_email on sellers and buyers
CREATE OR REPLACE FUNCTION set_is_mobile_is_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_mobile := (NEW.phone IS NOT NULL AND TRIM(NEW.phone) <> '');
  NEW.is_email := (NEW.email IS NOT NULL AND TRIM(NEW.email) <> '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_sellers_mobile_email ON sellers;
CREATE TRIGGER trigger_set_sellers_mobile_email
  BEFORE INSERT OR UPDATE ON sellers
  FOR EACH ROW
  EXECUTE FUNCTION set_is_mobile_is_email();

DROP TRIGGER IF EXISTS trigger_set_buyers_mobile_email ON buyers;
CREATE TRIGGER trigger_set_buyers_mobile_email
  BEFORE INSERT OR UPDATE ON buyers
  FOR EACH ROW
  EXECUTE FUNCTION set_is_mobile_is_email();

-- Create trigger function to sync seller_id from sellers to contracts table
CREATE OR REPLACE FUNCTION sync_seller_id_to_contracts()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL AND TRIM(NEW.seller_id) <> '' THEN
    UPDATE contracts
    SET seller_id = NEW.seller_id
    WHERE id = NEW.contract_id AND (seller_id IS NULL OR seller_id <> NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_seller_id_to_contracts ON sellers;
CREATE TRIGGER trigger_sync_seller_id_to_contracts
  AFTER INSERT OR UPDATE OF seller_id, contract_id ON sellers
  FOR EACH ROW
  EXECUTE FUNCTION sync_seller_id_to_contracts();

-- Backfill contracts seller_id
UPDATE contracts c
SET seller_id = s.seller_id
FROM sellers s
WHERE s.contract_id = c.id
  AND s.seller_id IS NOT NULL
  AND TRIM(s.seller_id) <> ''
  AND (c.seller_id IS NULL OR c.seller_id <> s.seller_id);

-- Backfill sellers
UPDATE sellers
SET is_mobile = (phone IS NOT NULL AND TRIM(phone) <> ''),
    is_email = (email IS NOT NULL AND TRIM(email) <> '');

-- Backfill buyers
UPDATE buyers
SET is_mobile = (phone IS NOT NULL AND TRIM(phone) <> ''),
    is_email = (email IS NOT NULL AND TRIM(email) <> '');

-- migrate:down

DROP TRIGGER IF EXISTS trigger_sync_seller_id_to_contracts ON sellers;
DROP FUNCTION IF EXISTS sync_seller_id_to_contracts();

DROP TRIGGER IF EXISTS trigger_set_sellers_mobile_email ON sellers;
DROP TRIGGER IF EXISTS trigger_set_buyers_mobile_email ON buyers;
DROP FUNCTION IF EXISTS set_is_mobile_is_email();

DROP INDEX IF EXISTS idx_contracts_seller_id;

ALTER TABLE contracts DROP COLUMN IF EXISTS seller_id;

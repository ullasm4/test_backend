-- migrate:up transaction:false

-- =========================================================================
-- 1. New counter columns on total_counts for new_* tables
-- =========================================================================
ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS new_contracts    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_sellers      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_buyers       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_sellers_with_phone BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_buyers_with_email  BIGINT NOT NULL DEFAULT 0;

-- =========================================================================
-- 2. Triggers: new_contracts count
-- =========================================================================
CREATE OR REPLACE FUNCTION update_new_contracts_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_contracts = new_contracts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_contracts = GREATEST(0, new_contracts - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_contracts_count ON new_contracts;
CREATE TRIGGER trigger_update_new_contracts_count
AFTER INSERT OR DELETE ON new_contracts
FOR EACH ROW EXECUTE FUNCTION update_new_contracts_count();

-- =========================================================================
-- 3. Triggers: new_sellers count
-- =========================================================================
CREATE OR REPLACE FUNCTION update_new_sellers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_sellers = new_sellers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_sellers = GREATEST(0, new_sellers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_sellers_count ON new_seller_details;
CREATE TRIGGER trigger_update_new_sellers_count
AFTER INSERT OR DELETE ON new_seller_details
FOR EACH ROW EXECUTE FUNCTION update_new_sellers_count();

-- =========================================================================
-- 4. Triggers: new_buyers count
-- =========================================================================
CREATE OR REPLACE FUNCTION update_new_buyers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_buyers = new_buyers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_buyers = GREATEST(0, new_buyers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_buyers_count ON new_buyer_details;
CREATE TRIGGER trigger_update_new_buyers_count
AFTER INSERT OR DELETE ON new_buyer_details
FOR EACH ROW EXECUTE FUNCTION update_new_buyers_count();

-- =========================================================================
-- 5. Triggers: new_sellers_with_phone (distinct sellers that have phone)
-- =========================================================================
CREATE OR REPLACE FUNCTION update_new_sellers_with_phone_count()
RETURNS TRIGGER AS $$
DECLARE
  has_phone boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    has_phone := (NEW.phone IS NOT NULL AND BTRIM(NEW.phone) <> '');
    IF has_phone THEN
      IF NOT EXISTS (
        SELECT 1 FROM new_seller_information
        WHERE seller_id = NEW.seller_id AND id <> NEW.id
          AND phone IS NOT NULL AND BTRIM(phone) <> ''
      ) THEN
        UPDATE total_counts SET new_sellers_with_phone = new_sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    has_phone := (OLD.phone IS NOT NULL AND BTRIM(OLD.phone) <> '');
    IF has_phone THEN
      IF NOT EXISTS (
        SELECT 1 FROM new_seller_information
        WHERE seller_id = OLD.seller_id
          AND phone IS NOT NULL AND BTRIM(phone) <> ''
      ) THEN
        UPDATE total_counts SET new_sellers_with_phone = GREATEST(0, new_sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (NEW.phone IS DISTINCT FROM OLD.phone) OR (NEW.seller_id IS DISTINCT FROM OLD.seller_id) THEN
      -- Check if old seller loses its last phone
      IF (OLD.phone IS NOT NULL AND BTRIM(OLD.phone) <> '') THEN
        IF NOT EXISTS (
          SELECT 1 FROM new_seller_information
          WHERE seller_id = OLD.seller_id AND id <> OLD.id
            AND phone IS NOT NULL AND BTRIM(phone) <> ''
        ) THEN
          UPDATE total_counts SET new_sellers_with_phone = GREATEST(0, new_sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
        END IF;
      END IF;
      -- Check if new seller gains its first phone
      IF (NEW.phone IS NOT NULL AND BTRIM(NEW.phone) <> '') THEN
        IF NOT EXISTS (
          SELECT 1 FROM new_seller_information
          WHERE seller_id = NEW.seller_id AND id <> NEW.id
            AND phone IS NOT NULL AND BTRIM(phone) <> ''
        ) THEN
          UPDATE total_counts SET new_sellers_with_phone = new_sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_sellers_with_phone ON new_seller_information;
CREATE TRIGGER trigger_update_new_sellers_with_phone
AFTER INSERT OR DELETE OR UPDATE OF phone, seller_id ON new_seller_information
FOR EACH ROW EXECUTE FUNCTION update_new_sellers_with_phone_count();

-- =========================================================================
-- 6. Triggers: new_buyers_with_email
-- =========================================================================
CREATE OR REPLACE FUNCTION update_new_buyers_with_email_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.email IS NOT NULL AND BTRIM(NEW.email) <> '' THEN
      UPDATE total_counts SET new_buyers_with_email = new_buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.email IS NOT NULL AND BTRIM(OLD.email) <> '' THEN
      UPDATE total_counts SET new_buyers_with_email = GREATEST(0, new_buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      IF OLD.email IS NOT NULL AND BTRIM(OLD.email) <> '' THEN
        UPDATE total_counts SET new_buyers_with_email = GREATEST(0, new_buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
      IF NEW.email IS NOT NULL AND BTRIM(NEW.email) <> '' THEN
        UPDATE total_counts SET new_buyers_with_email = new_buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_buyers_with_email ON new_buyer_details;
CREATE TRIGGER trigger_update_new_buyers_with_email
AFTER INSERT OR DELETE OR UPDATE OF email ON new_buyer_details
FOR EACH ROW EXECUTE FUNCTION update_new_buyers_with_email_count();

-- =========================================================================
-- 7. Move contracts_today / contracts_week trigger to new_contracts
-- =========================================================================
DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON contracts;

CREATE OR REPLACE FUNCTION update_contracts_period_counts()
RETURNS TRIGGER AS $$
DECLARE
  day_start TIMESTAMPTZ := DATE_TRUNC('day', NOW());
  week_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts
    SET contracts_today = contracts_today + CASE WHEN NEW.created_at >= day_start THEN 1 ELSE 0 END,
        contracts_week = contracts_week + CASE WHEN NEW.created_at >= week_start THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts
    SET contracts_today = GREATEST(0, contracts_today - CASE WHEN OLD.created_at >= day_start THEN 1 ELSE 0 END),
        contracts_week = GREATEST(0, contracts_week - CASE WHEN OLD.created_at >= week_start THEN 1 ELSE 0 END),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON new_contracts;
CREATE TRIGGER trigger_update_contracts_period_counts
AFTER INSERT OR DELETE ON new_contracts
FOR EACH ROW EXECUTE FUNCTION update_contracts_period_counts();

-- =========================================================================
-- 8. Move value range bucket trigger to new_contracts
-- =========================================================================
DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON contracts;

DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON new_contracts;
CREATE TRIGGER trigger_update_contract_value_bucket_counts
AFTER INSERT OR DELETE OR UPDATE OF total_value ON new_contracts
FOR EACH ROW EXECUTE FUNCTION update_contract_value_bucket_counts();

-- =========================================================================
-- 9. Seed all new counters
-- =========================================================================
UPDATE total_counts
SET
  new_contracts = (SELECT COUNT(*)::bigint FROM new_contracts),
  new_sellers = (SELECT COUNT(*)::bigint FROM new_seller_details),
  new_buyers = (SELECT COUNT(*)::bigint FROM new_buyer_details),
  new_sellers_with_phone = (
    SELECT COUNT(DISTINCT si.seller_id)::bigint
    FROM new_seller_information si
    WHERE si.phone IS NOT NULL AND BTRIM(si.phone) <> ''
  ),
  new_buyers_with_email = (
    SELECT COUNT(*)::bigint FROM new_buyer_details
    WHERE email IS NOT NULL AND BTRIM(email) <> ''
  ),
  contracts_today = (SELECT COUNT(*)::bigint FROM new_contracts WHERE created_at >= CURRENT_DATE),
  contracts_week = (SELECT COUNT(*)::bigint FROM new_contracts WHERE created_at >= NOW() - INTERVAL '7 days'),
  value_0_50k = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value IS NOT NULL AND total_value > 0 AND total_value <= 50000),
  value_50k_5l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 50000 AND total_value <= 500000),
  value_5l_10l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 500000 AND total_value <= 1000000),
  value_10l_50l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 1000000 AND total_value <= 5000000),
  value_50l_1cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 5000000 AND total_value <= 10000000),
  value_1cr_5cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 10000000 AND total_value <= 50000000),
  value_5cr_10cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 50000000 AND total_value <= 100000000),
  value_10cr_50cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 100000000 AND total_value <= 500000000),
  value_50cr_plus = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 500000000),
  dashboard_day = CURRENT_DATE,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- migrate:down transaction:false

-- Restore value range trigger to old contracts table
DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON new_contracts;
CREATE TRIGGER trigger_update_contract_value_bucket_counts
AFTER INSERT OR DELETE OR UPDATE OF total_value ON contracts
FOR EACH ROW EXECUTE FUNCTION update_contract_value_bucket_counts();

-- Restore period trigger to old contracts table
DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON new_contracts;
CREATE TRIGGER trigger_update_contracts_period_counts
AFTER INSERT OR DELETE ON contracts
FOR EACH ROW EXECUTE FUNCTION update_contracts_period_counts();

DROP TRIGGER IF EXISTS trigger_update_new_buyers_with_email ON new_buyer_details;
DROP FUNCTION IF EXISTS update_new_buyers_with_email_count();

DROP TRIGGER IF EXISTS trigger_update_new_sellers_with_phone ON new_seller_information;
DROP FUNCTION IF EXISTS update_new_sellers_with_phone_count();

DROP TRIGGER IF EXISTS trigger_update_new_buyers_count ON new_buyer_details;
DROP FUNCTION IF EXISTS update_new_buyers_count();

DROP TRIGGER IF EXISTS trigger_update_new_sellers_count ON new_seller_details;
DROP FUNCTION IF EXISTS update_new_sellers_count();

DROP TRIGGER IF EXISTS trigger_update_new_contracts_count ON new_contracts;
DROP FUNCTION IF EXISTS update_new_contracts_count();

ALTER TABLE total_counts
  DROP COLUMN IF EXISTS new_buyers_with_email,
  DROP COLUMN IF EXISTS new_sellers_with_phone,
  DROP COLUMN IF EXISTS new_buyers,
  DROP COLUMN IF EXISTS new_sellers,
  DROP COLUMN IF EXISTS new_contracts;

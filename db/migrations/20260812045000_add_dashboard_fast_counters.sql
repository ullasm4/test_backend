-- migrate:up

ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS sellers_with_phone BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyers_with_email BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contracts_today BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contracts_week BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ministries BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dashboard_day DATE;

-- Sellers with phone
CREATE OR REPLACE FUNCTION update_sellers_with_phone_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.is_mobile IS TRUE THEN
      UPDATE total_counts SET sellers_with_phone = sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.is_mobile IS TRUE THEN
      UPDATE total_counts SET sellers_with_phone = GREATEST(0, sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.is_mobile IS DISTINCT FROM OLD.is_mobile THEN
      UPDATE total_counts
      SET sellers_with_phone = GREATEST(0, sellers_with_phone
            + CASE WHEN NEW.is_mobile IS TRUE THEN 1 ELSE 0 END
            - CASE WHEN OLD.is_mobile IS TRUE THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_sellers_with_phone_count ON sellers;
CREATE TRIGGER trigger_update_sellers_with_phone_count
AFTER INSERT OR DELETE OR UPDATE OF is_mobile ON sellers
FOR EACH ROW EXECUTE FUNCTION update_sellers_with_phone_count();

-- Buyers with email
CREATE OR REPLACE FUNCTION update_buyers_with_email_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.is_email IS TRUE THEN
      UPDATE total_counts SET buyers_with_email = buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.is_email IS TRUE THEN
      UPDATE total_counts SET buyers_with_email = GREATEST(0, buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.is_email IS DISTINCT FROM OLD.is_email THEN
      UPDATE total_counts
      SET buyers_with_email = GREATEST(0, buyers_with_email
            + CASE WHEN NEW.is_email IS TRUE THEN 1 ELSE 0 END
            - CASE WHEN OLD.is_email IS TRUE THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_buyers_with_email_count ON buyers;
CREATE TRIGGER trigger_update_buyers_with_email_count
AFTER INSERT OR DELETE OR UPDATE OF is_email ON buyers
FOR EACH ROW EXECUTE FUNCTION update_buyers_with_email_count();

-- Ministries count
CREATE OR REPLACE FUNCTION update_total_ministries_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET total_ministries = total_ministries + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET total_ministries = GREATEST(0, total_ministries - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_ministries_count ON contract_ministry;
CREATE TRIGGER trigger_update_total_ministries_count
AFTER INSERT OR DELETE ON contract_ministry
FOR EACH ROW EXECUTE FUNCTION update_total_ministries_count();

-- Contracts today / week (insert/delete only; day rollover handled in dashboard read)
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

DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON contracts;
CREATE TRIGGER trigger_update_contracts_period_counts
AFTER INSERT OR DELETE ON contracts
FOR EACH ROW EXECUTE FUNCTION update_contracts_period_counts();

-- Seed
UPDATE total_counts
SET
  sellers_with_phone = (SELECT COUNT(*)::bigint FROM sellers WHERE is_mobile = true),
  buyers_with_email = (SELECT COUNT(*)::bigint FROM buyers WHERE is_email = true),
  total_ministries = (SELECT COUNT(*)::bigint FROM contract_ministry),
  contracts_today = (SELECT COUNT(*)::bigint FROM contracts WHERE created_at >= CURRENT_DATE),
  contracts_week = (SELECT COUNT(*)::bigint FROM contracts WHERE created_at >= NOW() - INTERVAL '7 days'),
  dashboard_day = CURRENT_DATE,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON contracts;
DROP FUNCTION IF EXISTS update_contracts_period_counts();

DROP TRIGGER IF EXISTS trigger_update_total_ministries_count ON contract_ministry;
DROP FUNCTION IF EXISTS update_total_ministries_count();

DROP TRIGGER IF EXISTS trigger_update_buyers_with_email_count ON buyers;
DROP FUNCTION IF EXISTS update_buyers_with_email_count();

DROP TRIGGER IF EXISTS trigger_update_sellers_with_phone_count ON sellers;
DROP FUNCTION IF EXISTS update_sellers_with_phone_count();

ALTER TABLE total_counts
  DROP COLUMN IF EXISTS sellers_with_phone,
  DROP COLUMN IF EXISTS buyers_with_email,
  DROP COLUMN IF EXISTS contracts_today,
  DROP COLUMN IF EXISTS contracts_week,
  DROP COLUMN IF EXISTS total_ministries,
  DROP COLUMN IF EXISTS dashboard_day;

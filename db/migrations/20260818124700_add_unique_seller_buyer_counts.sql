-- migrate:up

ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS unique_sellers BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_buyers BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION seller_identity_key(p_name varchar, p_phone varchar, p_email varchar)
RETURNS text AS $$
  SELECT LOWER(BTRIM(COALESCE(p_name, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION buyer_identity_key(p_name varchar, p_phone varchar, p_email varchar)
RETURNS text AS $$
  SELECT LOWER(BTRIM(COALESCE(p_name, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION seller_identity_exists(p_name varchar, p_phone varchar, p_email varchar, p_exclude uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM sellers s
    WHERE (p_exclude IS NULL OR s.id <> p_exclude)
      AND LOWER(BTRIM(COALESCE(s.company_name, ''))) = LOWER(BTRIM(COALESCE(p_name, '')))
      AND LOWER(BTRIM(COALESCE(s.phone, ''))) = LOWER(BTRIM(COALESCE(p_phone, '')))
      AND LOWER(BTRIM(COALESCE(s.email, ''))) = LOWER(BTRIM(COALESCE(p_email, '')))
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION buyer_identity_exists(p_name varchar, p_phone varchar, p_email varchar, p_exclude uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM buyers b
    WHERE (p_exclude IS NULL OR b.id <> p_exclude)
      AND LOWER(BTRIM(COALESCE(b.company_name, ''))) = LOWER(BTRIM(COALESCE(p_name, '')))
      AND LOWER(BTRIM(COALESCE(b.phone, ''))) = LOWER(BTRIM(COALESCE(p_phone, '')))
      AND LOWER(BTRIM(COALESCE(b.email, ''))) = LOWER(BTRIM(COALESCE(p_email, '')))
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION update_unique_sellers_count()
RETURNS TRIGGER AS $$
DECLARE
  old_key text;
  new_key text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NOT seller_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = unique_sellers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    IF NOT seller_identity_exists(OLD.company_name, OLD.phone, OLD.email, NULL) THEN
      UPDATE total_counts
      SET unique_sellers = GREATEST(0, unique_sellers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_key := seller_identity_key(OLD.company_name, OLD.phone, OLD.email);
    new_key := seller_identity_key(NEW.company_name, NEW.phone, NEW.email);
    IF old_key = new_key THEN
      RETURN NULL;
    END IF;
    IF NOT seller_identity_exists(OLD.company_name, OLD.phone, OLD.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = GREATEST(0, unique_sellers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    IF NOT seller_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = unique_sellers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_unique_buyers_count()
RETURNS TRIGGER AS $$
DECLARE
  old_key text;
  new_key text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NOT buyer_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = unique_buyers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    IF NOT buyer_identity_exists(OLD.company_name, OLD.phone, OLD.email, NULL) THEN
      UPDATE total_counts
      SET unique_buyers = GREATEST(0, unique_buyers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_key := buyer_identity_key(OLD.company_name, OLD.phone, OLD.email);
    new_key := buyer_identity_key(NEW.company_name, NEW.phone, NEW.email);
    IF old_key = new_key THEN
      RETURN NULL;
    END IF;
    IF NOT buyer_identity_exists(OLD.company_name, OLD.phone, OLD.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = GREATEST(0, unique_buyers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    IF NOT buyer_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = unique_buyers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_unique_sellers_count ON sellers;
CREATE TRIGGER trigger_update_unique_sellers_count
AFTER INSERT OR DELETE OR UPDATE OF company_name, phone, email ON sellers
FOR EACH ROW
EXECUTE FUNCTION update_unique_sellers_count();

DROP TRIGGER IF EXISTS trigger_update_unique_buyers_count ON buyers;
CREATE TRIGGER trigger_update_unique_buyers_count
AFTER INSERT OR DELETE OR UPDATE OF company_name, phone, email ON buyers
FOR EACH ROW
EXECUTE FUNCTION update_unique_buyers_count();

UPDATE total_counts
SET unique_sellers = (
      SELECT COUNT(*) FROM (
        SELECT 1
        FROM sellers
        GROUP BY LOWER(BTRIM(COALESCE(company_name, ''))),
                 LOWER(BTRIM(COALESCE(phone, ''))),
                 LOWER(BTRIM(COALESCE(email, '')))
      ) t
    ),
    unique_buyers = (
      SELECT COUNT(*) FROM (
        SELECT 1
        FROM buyers
        GROUP BY LOWER(BTRIM(COALESCE(company_name, ''))),
                 LOWER(BTRIM(COALESCE(phone, ''))),
                 LOWER(BTRIM(COALESCE(email, '')))
      ) t
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_unique_buyers_count ON buyers;
DROP TRIGGER IF EXISTS trigger_update_unique_sellers_count ON sellers;
DROP FUNCTION IF EXISTS update_unique_buyers_count();
DROP FUNCTION IF EXISTS update_unique_sellers_count();
DROP FUNCTION IF EXISTS buyer_identity_exists(varchar, varchar, varchar, uuid);
DROP FUNCTION IF EXISTS seller_identity_exists(varchar, varchar, varchar, uuid);
DROP FUNCTION IF EXISTS buyer_identity_key(varchar, varchar, varchar);
DROP FUNCTION IF EXISTS seller_identity_key(varchar, varchar, varchar);
ALTER TABLE total_counts DROP COLUMN IF EXISTS unique_buyers;
ALTER TABLE total_counts DROP COLUMN IF EXISTS unique_sellers;

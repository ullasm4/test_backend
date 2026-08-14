-- migrate:up

ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS value_0_50k BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_50k_5l BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_5l_10l BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_10l_50l BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_50l_1cr BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_1cr_5cr BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_5cr_10cr BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_10cr_50cr BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_50cr_plus BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION contract_value_bucket_column(v numeric)
RETURNS text AS $$
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  ELSIF v <= 50000 THEN
    RETURN 'value_0_50k';
  ELSIF v <= 500000 THEN
    RETURN 'value_50k_5l';
  ELSIF v <= 1000000 THEN
    RETURN 'value_5l_10l';
  ELSIF v <= 5000000 THEN
    RETURN 'value_10l_50l';
  ELSIF v <= 10000000 THEN
    RETURN 'value_50l_1cr';
  ELSIF v <= 50000000 THEN
    RETURN 'value_1cr_5cr';
  ELSIF v <= 100000000 THEN
    RETURN 'value_5cr_10cr';
  ELSIF v <= 500000000 THEN
    RETURN 'value_10cr_50cr';
  ELSE
    RETURN 'value_50cr_plus';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION apply_contract_value_bucket_delta(old_bucket text, new_bucket text)
RETURNS void AS $$
BEGIN
  IF old_bucket IS NOT DISTINCT FROM new_bucket THEN
    RETURN;
  END IF;

  UPDATE total_counts
  SET
    value_0_50k = GREATEST(0, value_0_50k
      + CASE WHEN new_bucket = 'value_0_50k' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_0_50k' THEN 1 ELSE 0 END),
    value_50k_5l = GREATEST(0, value_50k_5l
      + CASE WHEN new_bucket = 'value_50k_5l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50k_5l' THEN 1 ELSE 0 END),
    value_5l_10l = GREATEST(0, value_5l_10l
      + CASE WHEN new_bucket = 'value_5l_10l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_5l_10l' THEN 1 ELSE 0 END),
    value_10l_50l = GREATEST(0, value_10l_50l
      + CASE WHEN new_bucket = 'value_10l_50l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_10l_50l' THEN 1 ELSE 0 END),
    value_50l_1cr = GREATEST(0, value_50l_1cr
      + CASE WHEN new_bucket = 'value_50l_1cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50l_1cr' THEN 1 ELSE 0 END),
    value_1cr_5cr = GREATEST(0, value_1cr_5cr
      + CASE WHEN new_bucket = 'value_1cr_5cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_1cr_5cr' THEN 1 ELSE 0 END),
    value_5cr_10cr = GREATEST(0, value_5cr_10cr
      + CASE WHEN new_bucket = 'value_5cr_10cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_5cr_10cr' THEN 1 ELSE 0 END),
    value_10cr_50cr = GREATEST(0, value_10cr_50cr
      + CASE WHEN new_bucket = 'value_10cr_50cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_10cr_50cr' THEN 1 ELSE 0 END),
    value_50cr_plus = GREATEST(0, value_50cr_plus
      + CASE WHEN new_bucket = 'value_50cr_plus' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50cr_plus' THEN 1 ELSE 0 END),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_contract_value_bucket_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM apply_contract_value_bucket_delta(NULL, contract_value_bucket_column(NEW.total_value));
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM apply_contract_value_bucket_delta(contract_value_bucket_column(OLD.total_value), NULL);
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.total_value IS DISTINCT FROM OLD.total_value THEN
      PERFORM apply_contract_value_bucket_delta(
        contract_value_bucket_column(OLD.total_value),
        contract_value_bucket_column(NEW.total_value)
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON contracts;
CREATE TRIGGER trigger_update_contract_value_bucket_counts
AFTER INSERT OR DELETE OR UPDATE OF total_value ON contracts
FOR EACH ROW EXECUTE FUNCTION update_contract_value_bucket_counts();

UPDATE total_counts
SET
  value_0_50k = s.value_0_50k,
  value_50k_5l = s.value_50k_5l,
  value_5l_10l = s.value_5l_10l,
  value_10l_50l = s.value_10l_50l,
  value_50l_1cr = s.value_50l_1cr,
  value_1cr_5cr = s.value_1cr_5cr,
  value_5cr_10cr = s.value_5cr_10cr,
  value_10cr_50cr = s.value_10cr_50cr,
  value_50cr_plus = s.value_50cr_plus,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    COUNT(*) FILTER (WHERE total_value IS NOT NULL AND total_value <= 50000)::bigint AS value_0_50k,
    COUNT(*) FILTER (WHERE total_value > 50000 AND total_value <= 500000)::bigint AS value_50k_5l,
    COUNT(*) FILTER (WHERE total_value > 500000 AND total_value <= 1000000)::bigint AS value_5l_10l,
    COUNT(*) FILTER (WHERE total_value > 1000000 AND total_value <= 5000000)::bigint AS value_10l_50l,
    COUNT(*) FILTER (WHERE total_value > 5000000 AND total_value <= 10000000)::bigint AS value_50l_1cr,
    COUNT(*) FILTER (WHERE total_value > 10000000 AND total_value <= 50000000)::bigint AS value_1cr_5cr,
    COUNT(*) FILTER (WHERE total_value > 50000000 AND total_value <= 100000000)::bigint AS value_5cr_10cr,
    COUNT(*) FILTER (WHERE total_value > 100000000 AND total_value <= 500000000)::bigint AS value_10cr_50cr,
    COUNT(*) FILTER (WHERE total_value > 500000000)::bigint AS value_50cr_plus
  FROM contracts
) s
WHERE total_counts.id = 1;

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON contracts;
DROP FUNCTION IF EXISTS update_contract_value_bucket_counts();
DROP FUNCTION IF EXISTS apply_contract_value_bucket_delta(text, text);
DROP FUNCTION IF EXISTS contract_value_bucket_column(numeric);

ALTER TABLE total_counts
  DROP COLUMN IF EXISTS value_0_50k,
  DROP COLUMN IF EXISTS value_50k_5l,
  DROP COLUMN IF EXISTS value_5l_10l,
  DROP COLUMN IF EXISTS value_10l_50l,
  DROP COLUMN IF EXISTS value_50l_1cr,
  DROP COLUMN IF EXISTS value_1cr_5cr,
  DROP COLUMN IF EXISTS value_5cr_10cr,
  DROP COLUMN IF EXISTS value_10cr_50cr,
  DROP COLUMN IF EXISTS value_50cr_plus;

-- migrate:up

CREATE OR REPLACE FUNCTION contract_is_canonical(p_id uuid, p_contract_number text)
RETURNS boolean AS $$
  SELECT p_id = (
    SELECT c.id
    FROM contracts c
    WHERE c.contract_number = p_contract_number
    ORDER BY c.created_at DESC NULLS LAST, c.id DESC
    LIMIT 1
  )
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION update_contract_value_bucket_counts()
RETURNS TRIGGER AS $$
DECLARE
  previous_canonical_value numeric;
  next_canonical_value numeric;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.contract_number IS NULL OR BTRIM(NEW.contract_number) = '' THEN
      PERFORM apply_contract_value_bucket_delta(NULL, contract_value_bucket_column(NEW.total_value));
      RETURN NULL;
    END IF;

    IF NOT contract_is_canonical(NEW.id, NEW.contract_number) THEN
      RETURN NULL;
    END IF;

    SELECT c.total_value
    INTO previous_canonical_value
    FROM contracts c
    WHERE c.contract_number = NEW.contract_number
      AND c.id <> NEW.id
    ORDER BY c.created_at DESC NULLS LAST, c.id DESC
    LIMIT 1;

    IF previous_canonical_value IS NULL THEN
      PERFORM apply_contract_value_bucket_delta(NULL, contract_value_bucket_column(NEW.total_value));
    ELSE
      PERFORM apply_contract_value_bucket_delta(
        contract_value_bucket_column(previous_canonical_value),
        contract_value_bucket_column(NEW.total_value)
      );
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.contract_number IS NULL OR BTRIM(OLD.contract_number) = '' THEN
      PERFORM apply_contract_value_bucket_delta(contract_value_bucket_column(OLD.total_value), NULL);
      RETURN NULL;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM contracts c
      WHERE c.contract_number = OLD.contract_number
        AND (
          c.created_at > OLD.created_at
          OR (c.created_at = OLD.created_at AND c.id > OLD.id)
        )
    ) THEN
      RETURN NULL;
    END IF;

    SELECT c.total_value
    INTO next_canonical_value
    FROM contracts c
    WHERE c.contract_number = OLD.contract_number
    ORDER BY c.created_at DESC NULLS LAST, c.id DESC
    LIMIT 1;

    IF next_canonical_value IS NULL THEN
      PERFORM apply_contract_value_bucket_delta(contract_value_bucket_column(OLD.total_value), NULL);
    ELSE
      PERFORM apply_contract_value_bucket_delta(
        contract_value_bucket_column(OLD.total_value),
        contract_value_bucket_column(next_canonical_value)
      );
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.contract_number IS NULL OR BTRIM(NEW.contract_number) = '' THEN
      IF NEW.total_value IS DISTINCT FROM OLD.total_value THEN
        PERFORM apply_contract_value_bucket_delta(
          contract_value_bucket_column(OLD.total_value),
          contract_value_bucket_column(NEW.total_value)
        );
      END IF;
      RETURN NULL;
    END IF;

    IF contract_is_canonical(NEW.id, NEW.contract_number)
       AND NEW.total_value IS DISTINCT FROM OLD.total_value THEN
      PERFORM apply_contract_value_bucket_delta(
        contract_value_bucket_column(OLD.total_value),
        contract_value_bucket_column(NEW.total_value)
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

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
  FROM (
    SELECT DISTINCT ON (contract_number)
      total_value
    FROM contracts
    WHERE contract_number IS NOT NULL
      AND BTRIM(contract_number) <> ''
    ORDER BY contract_number, created_at DESC NULLS LAST, id DESC
  ) unique_contracts
) s
WHERE total_counts.id = 1;

-- migrate:down

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

DROP FUNCTION IF EXISTS contract_is_canonical(uuid, text);

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

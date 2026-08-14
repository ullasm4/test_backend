-- migrate:up

CREATE OR REPLACE FUNCTION contract_bid_number_missing(v text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT v IS NULL OR BTRIM(v) = '';
$$;

CREATE INDEX IF NOT EXISTS idx_contracts_bid_null_list
  ON contracts (contract_date DESC NULLS LAST, created_at DESC)
  WHERE contract_bid_number_missing(bid_number);

CREATE INDEX IF NOT EXISTS idx_contracts_bid_null_value
  ON contracts (total_value DESC NULLS LAST, created_at DESC)
  WHERE contract_bid_number_missing(bid_number);

ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS contracts_bid_number_null BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION update_contracts_bid_number_null_count()
RETURNS TRIGGER AS $$
DECLARE
  old_missing boolean;
  new_missing boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF contract_bid_number_missing(NEW.bid_number) THEN
      UPDATE total_counts
      SET contracts_bid_number_null = contracts_bid_number_null + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF contract_bid_number_missing(OLD.bid_number) THEN
      UPDATE total_counts
      SET contracts_bid_number_null = GREATEST(0, contracts_bid_number_null - 1),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_missing := contract_bid_number_missing(OLD.bid_number);
    new_missing := contract_bid_number_missing(NEW.bid_number);
    IF old_missing IS DISTINCT FROM new_missing THEN
      UPDATE total_counts
      SET contracts_bid_number_null = GREATEST(0, contracts_bid_number_null
            + CASE WHEN new_missing THEN 1 ELSE 0 END
            - CASE WHEN old_missing THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_contracts_bid_number_null_count ON contracts;
CREATE TRIGGER trigger_update_contracts_bid_number_null_count
AFTER INSERT OR DELETE OR UPDATE OF bid_number ON contracts
FOR EACH ROW EXECUTE FUNCTION update_contracts_bid_number_null_count();

UPDATE total_counts
SET
  contracts_bid_number_null = (
    SELECT COUNT(*)::bigint
    FROM contracts
    WHERE contract_bid_number_missing(bid_number)
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_contracts_bid_number_null_count ON contracts;
DROP FUNCTION IF EXISTS update_contracts_bid_number_null_count();
DROP INDEX IF EXISTS idx_contracts_bid_null_value;
DROP INDEX IF EXISTS idx_contracts_bid_null_list;
DROP FUNCTION IF EXISTS contract_bid_number_missing(text);
ALTER TABLE total_counts DROP COLUMN IF EXISTS contracts_bid_number_null;

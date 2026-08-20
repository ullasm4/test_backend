-- migrate:up

CREATE OR REPLACE FUNCTION contract_bid_number_present(v text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT v IS NOT NULL AND BTRIM(v) <> '';
$$;

ALTER TABLE total_counts
  ADD COLUMN IF NOT EXISTS new_contracts_with_bid_number BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION update_new_contracts_bid_present_count()
RETURNS TRIGGER AS $$
DECLARE
  old_present boolean;
  new_present boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF contract_bid_number_present(NEW.bid_number) THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = new_contracts_with_bid_number + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF contract_bid_number_present(OLD.bid_number) THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = GREATEST(0, new_contracts_with_bid_number - 1),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_present := contract_bid_number_present(OLD.bid_number);
    new_present := contract_bid_number_present(NEW.bid_number);
    IF old_present IS DISTINCT FROM new_present THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = GREATEST(0, new_contracts_with_bid_number
            + CASE WHEN new_present THEN 1 ELSE 0 END
            - CASE WHEN old_present THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_contracts_bid_present_count ON new_contracts;
CREATE TRIGGER trigger_update_new_contracts_bid_present_count
AFTER INSERT OR DELETE OR UPDATE OF bid_number ON new_contracts
FOR EACH ROW EXECUTE FUNCTION update_new_contracts_bid_present_count();

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_new_contracts_bid_present_count ON new_contracts;
DROP FUNCTION IF EXISTS update_new_contracts_bid_present_count();
ALTER TABLE total_counts DROP COLUMN IF EXISTS new_contracts_with_bid_number;
DROP FUNCTION IF EXISTS contract_bid_number_present(text);

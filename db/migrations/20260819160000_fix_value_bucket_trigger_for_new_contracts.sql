-- migrate:up

-- The old trigger referenced the dropped "contracts" table.
-- new_contracts has unique contract_number, so simple delta is sufficient.
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

-- Drop stale helpers that reference the old contracts table
DROP FUNCTION IF EXISTS contract_is_canonical(uuid, text);
DROP FUNCTION IF EXISTS sync_seller_analysis();

-- migrate:down

-- Cannot restore old function since "contracts" table no longer exists

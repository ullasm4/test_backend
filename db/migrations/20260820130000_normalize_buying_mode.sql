-- migrate:up

CREATE OR REPLACE FUNCTION normalize_buying_mode(p_name text)
RETURNS text AS $$
DECLARE
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF v_name IS NULL OR v_name ~* '^(?:[-–—.|]+|NA|N/A)$' THEN
    RETURN NULL;
  END IF;
  IF lower(v_name) = 'bid/ra' THEN
    RETURN 'Bid/RA';
  END IF;
  RETURN v_name;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION bump_contract_lookup(p_kind text, p_name text, p_delta integer)
RETURNS void AS $$
DECLARE
  v_name text := contract_lookup_name(p_name);
BEGIN
  IF v_name IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;

  IF p_kind = 'buying_mode' THEN
    v_name := normalize_buying_mode(v_name);
    IF v_name IS NULL THEN
      RETURN;
    END IF;
  END IF;

  IF p_kind = 'organization' THEN
    IF p_delta > 0 THEN
      INSERT INTO organizations (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = organizations.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE organizations
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'organization_type' THEN
    IF p_delta > 0 THEN
      INSERT INTO organization_types (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = organization_types.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE organization_types
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'department' THEN
    IF p_delta > 0 THEN
      INSERT INTO departments (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = departments.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE departments
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'buying_mode' THEN
    IF p_delta > 0 THEN
      INSERT INTO buying_modes (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = buying_modes.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE buying_modes
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE new_contracts DISABLE TRIGGER trigger_sync_contract_lookups;

-- Index-friendly: only rows that actually need changing (~BID/RA bulk), not full-table scan.
UPDATE new_contracts
SET buying_mode = 'Bid/RA'
WHERE buying_mode = 'BID/RA';

ALTER TABLE new_contracts ENABLE TRIGGER trigger_sync_contract_lookups;

-- Merge lookup counts in place — no full rescan of new_contracts.
INSERT INTO buying_modes (name, total_contract)
SELECT
  'Bid/RA',
  COALESCE((SELECT total_contract FROM buying_modes WHERE name = 'Bid/RA'), 0)
    + COALESCE((SELECT total_contract FROM buying_modes WHERE name = 'BID/RA'), 0)
ON CONFLICT (name) DO UPDATE
  SET total_contract = EXCLUDED.total_contract,
      updated_at = CURRENT_TIMESTAMP;

DELETE FROM buying_modes
WHERE name = 'BID/RA';

-- migrate:down

DROP FUNCTION IF EXISTS normalize_buying_mode(text);

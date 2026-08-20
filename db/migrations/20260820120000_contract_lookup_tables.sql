-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_buying_mode
  ON new_contracts USING gin (buying_mode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_new_contracts_buying_mode
  ON new_contracts (buying_mode);

CREATE INDEX IF NOT EXISTS idx_new_contracts_org_name
  ON new_contracts (org_name);

CREATE INDEX IF NOT EXISTS idx_new_contracts_department
  ON new_contracts (department);

CREATE INDEX IF NOT EXISTS idx_new_contracts_org_type
  ON new_contracts (org_type);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_contract bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_organizations_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS organization_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_contract bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_organization_types_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_contract bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_departments_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS buying_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_contract bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_buying_modes_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_organizations_total_contract
  ON organizations (total_contract DESC, name ASC);
CREATE INDEX IF NOT EXISTS idx_organization_types_total_contract
  ON organization_types (total_contract DESC, name ASC);
CREATE INDEX IF NOT EXISTS idx_departments_total_contract
  ON departments (total_contract DESC, name ASC);
CREATE INDEX IF NOT EXISTS idx_buying_modes_total_contract
  ON buying_modes (total_contract DESC, name ASC);

CREATE OR REPLACE FUNCTION contract_lookup_name(p_name text)
RETURNS text AS $$
DECLARE
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF v_name IS NULL OR v_name ~* '^(?:[-–—.|]+|NA|N/A)$' THEN
    RETURN NULL;
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

CREATE OR REPLACE FUNCTION sync_contract_lookups()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_contract_lookup('organization', NEW.org_name, 1);
    PERFORM bump_contract_lookup('organization_type', NEW.org_type, 1);
    PERFORM bump_contract_lookup('department', NEW.department, 1);
    PERFORM bump_contract_lookup('buying_mode', NEW.buying_mode, 1);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM bump_contract_lookup('organization', OLD.org_name, -1);
    PERFORM bump_contract_lookup('organization_type', OLD.org_type, -1);
    PERFORM bump_contract_lookup('department', OLD.department, -1);
    PERFORM bump_contract_lookup('buying_mode', OLD.buying_mode, -1);
    RETURN NULL;
  END IF;

  IF contract_lookup_name(NEW.org_name) IS DISTINCT FROM contract_lookup_name(OLD.org_name) THEN
    PERFORM bump_contract_lookup('organization', OLD.org_name, -1);
    PERFORM bump_contract_lookup('organization', NEW.org_name, 1);
  END IF;
  IF contract_lookup_name(NEW.org_type) IS DISTINCT FROM contract_lookup_name(OLD.org_type) THEN
    PERFORM bump_contract_lookup('organization_type', OLD.org_type, -1);
    PERFORM bump_contract_lookup('organization_type', NEW.org_type, 1);
  END IF;
  IF contract_lookup_name(NEW.department) IS DISTINCT FROM contract_lookup_name(OLD.department) THEN
    PERFORM bump_contract_lookup('department', OLD.department, -1);
    PERFORM bump_contract_lookup('department', NEW.department, 1);
  END IF;
  IF contract_lookup_name(NEW.buying_mode) IS DISTINCT FROM contract_lookup_name(OLD.buying_mode) THEN
    PERFORM bump_contract_lookup('buying_mode', OLD.buying_mode, -1);
    PERFORM bump_contract_lookup('buying_mode', NEW.buying_mode, 1);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

INSERT INTO organizations (name, total_contract)
SELECT name, COUNT(*)::bigint
FROM (
  SELECT contract_lookup_name(org_name) AS name
  FROM new_contracts
) src
WHERE name IS NOT NULL
GROUP BY name
ON CONFLICT (name) DO UPDATE
  SET total_contract = EXCLUDED.total_contract,
      updated_at = CURRENT_TIMESTAMP;

INSERT INTO organization_types (name, total_contract)
SELECT name, COUNT(*)::bigint
FROM (
  SELECT contract_lookup_name(org_type) AS name
  FROM new_contracts
) src
WHERE name IS NOT NULL
GROUP BY name
ON CONFLICT (name) DO UPDATE
  SET total_contract = EXCLUDED.total_contract,
      updated_at = CURRENT_TIMESTAMP;

INSERT INTO departments (name, total_contract)
SELECT name, COUNT(*)::bigint
FROM (
  SELECT contract_lookup_name(department) AS name
  FROM new_contracts
) src
WHERE name IS NOT NULL
GROUP BY name
ON CONFLICT (name) DO UPDATE
  SET total_contract = EXCLUDED.total_contract,
      updated_at = CURRENT_TIMESTAMP;

INSERT INTO buying_modes (name, total_contract)
SELECT name, COUNT(*)::bigint
FROM (
  SELECT contract_lookup_name(buying_mode) AS name
  FROM new_contracts
) src
WHERE name IS NOT NULL
GROUP BY name
ON CONFLICT (name) DO UPDATE
  SET total_contract = EXCLUDED.total_contract,
      updated_at = CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS trigger_sync_contract_lookups ON new_contracts;
CREATE TRIGGER trigger_sync_contract_lookups
AFTER INSERT OR DELETE OR UPDATE OF org_name, org_type, department, buying_mode
ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION sync_contract_lookups();

-- migrate:down

DROP TRIGGER IF EXISTS trigger_sync_contract_lookups ON new_contracts;
DROP FUNCTION IF EXISTS sync_contract_lookups();
DROP FUNCTION IF EXISTS bump_contract_lookup(text, text, integer);
DROP FUNCTION IF EXISTS contract_lookup_name(text);

DROP TABLE IF EXISTS buying_modes;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS organization_types;
DROP TABLE IF EXISTS organizations;

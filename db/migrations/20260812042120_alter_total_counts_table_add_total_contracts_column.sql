-- migrate:up transaction:false

-- Remove mistaken total_ministries column/trigger if present
DROP TRIGGER IF EXISTS trigger_update_total_ministries_count ON contract_ministry;
DROP FUNCTION IF EXISTS update_total_ministries_count();
ALTER TABLE total_counts DROP COLUMN IF EXISTS total_ministries;

-- total_contracts = SUM of all ministry total_contract values
-- Maintained via delta when ministry totals change (from contracts insert/delete/move)
CREATE OR REPLACE FUNCTION update_total_contracts_from_ministries()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        UPDATE total_counts
        SET total_contracts = GREATEST(0, total_contracts + (COALESCE(NEW.total_contract, 0) - COALESCE(OLD.total_contract, 0))),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts
        SET total_contracts = GREATEST(0, total_contracts - COALESCE(OLD.total_contract, 0)),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_contracts_from_ministries ON contract_ministry;
CREATE TRIGGER trigger_update_total_contracts_from_ministries
AFTER UPDATE OF total_contract OR DELETE ON contract_ministry
FOR EACH ROW
EXECUTE FUNCTION update_total_contracts_from_ministries();

-- Stop double-counting: contracts table no longer bumps total_contracts directly
DROP TRIGGER IF EXISTS trigger_update_total_contracts_count ON contracts;
DROP FUNCTION IF EXISTS update_total_contracts_count();

-- Seed total_contracts as sum of all ministry contracts
ALTER TABLE contracts DISABLE TRIGGER trigger_update_ministry_total_contract;
ALTER TABLE contract_ministry DISABLE TRIGGER trigger_update_total_contracts_from_ministries;

UPDATE contract_ministry m
SET total_contract = sub.cnt
FROM (
    SELECT cm.id, COUNT(c.id)::bigint AS cnt
    FROM contract_ministry cm
    LEFT JOIN contracts c ON c.ministry_id = cm.id
    GROUP BY cm.id
) sub
WHERE m.id = sub.id;

UPDATE total_counts
SET total_contracts = (SELECT COALESCE(SUM(total_contract), 0)::int FROM contract_ministry),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

ALTER TABLE contract_ministry ENABLE TRIGGER trigger_update_total_contracts_from_ministries;
ALTER TABLE contracts ENABLE TRIGGER trigger_update_ministry_total_contract;

-- migrate:down transaction:false

DROP TRIGGER IF EXISTS trigger_update_total_contracts_from_ministries ON contract_ministry;
DROP FUNCTION IF EXISTS update_total_contracts_from_ministries();

-- Restore original contracts → total_contracts counter
CREATE OR REPLACE FUNCTION update_total_contracts_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_contracts = total_contracts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_contracts = GREATEST(0, total_contracts - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_total_contracts_count ON contracts;
CREATE TRIGGER trigger_update_total_contracts_count
AFTER INSERT OR DELETE ON contracts
FOR EACH ROW
EXECUTE FUNCTION update_total_contracts_count();

UPDATE total_counts
SET total_contracts = (SELECT COUNT(*)::int FROM contracts),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

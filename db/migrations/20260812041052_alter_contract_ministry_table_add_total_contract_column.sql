-- migrate:up transaction:false

ALTER TABLE contract_ministry ADD COLUMN IF NOT EXISTS total_contract BIGINT NOT NULL DEFAULT 0;

-- Keep contract_ministry.total_contract in sync on contract insert/delete/ministry move
CREATE OR REPLACE FUNCTION update_ministry_total_contract()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE contract_ministry
        SET total_contract = total_contract + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.ministry_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE contract_ministry
        SET total_contract = GREATEST(0, total_contract - 1),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = OLD.ministry_id;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF NEW.ministry_id IS DISTINCT FROM OLD.ministry_id THEN
            UPDATE contract_ministry
            SET total_contract = GREATEST(0, total_contract - 1),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = OLD.ministry_id;

            UPDATE contract_ministry
            SET total_contract = total_contract + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.ministry_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ministry_total_contract ON contracts;
CREATE TRIGGER trigger_update_ministry_total_contract
AFTER INSERT OR DELETE OR UPDATE OF ministry_id ON contracts
FOR EACH ROW
EXECUTE FUNCTION update_ministry_total_contract();

-- Seed absolute counts with trigger disabled to avoid race under concurrent inserts
ALTER TABLE contracts DISABLE TRIGGER trigger_update_ministry_total_contract;

UPDATE contract_ministry m
SET total_contract = sub.cnt
FROM (
    SELECT cm.id, COUNT(c.id)::bigint AS cnt
    FROM contract_ministry cm
    LEFT JOIN contracts c ON c.ministry_id = cm.id
    GROUP BY cm.id
) sub
WHERE m.id = sub.id;

ALTER TABLE contracts ENABLE TRIGGER trigger_update_ministry_total_contract;

-- migrate:down transaction:false

DROP TRIGGER IF EXISTS trigger_update_ministry_total_contract ON contracts;
DROP FUNCTION IF EXISTS update_ministry_total_contract();

ALTER TABLE contract_ministry DROP COLUMN IF EXISTS total_contract;

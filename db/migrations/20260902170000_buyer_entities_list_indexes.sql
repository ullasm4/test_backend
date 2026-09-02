-- migrate:up

CREATE INDEX IF NOT EXISTS idx_buyer_entities_name
    ON buyer_entities (name);

CREATE INDEX IF NOT EXISTS idx_buyer_entities_prefix_id_name
    ON buyer_entities (prefix_id, name);

CREATE INDEX IF NOT EXISTS idx_buyer_entity_prefixes_level
    ON buyer_entity_prefixes (level);

CREATE INDEX IF NOT EXISTS idx_buyer_entity_prefixes_prefix_trgm
    ON buyer_entity_prefixes USING gin (prefix gin_trgm_ops);

-- migrate:down

DROP INDEX IF EXISTS idx_buyer_entity_prefixes_prefix_trgm;
DROP INDEX IF EXISTS idx_buyer_entity_prefixes_level;
DROP INDEX IF EXISTS idx_buyer_entities_prefix_id_name;
DROP INDEX IF EXISTS idx_buyer_entities_name;

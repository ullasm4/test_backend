-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS buyer_entity_prefixes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix text NOT NULL,
    total_entities integer NOT NULL DEFAULT 0,
    level integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_buyer_entity_prefixes_prefix UNIQUE (prefix),
    CONSTRAINT chk_buyer_entity_prefixes_level CHECK (level BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS idx_buyer_entity_prefixes_level_prefix
    ON buyer_entity_prefixes (level, prefix);

CREATE TABLE IF NOT EXISTS buyer_entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    prefix_id uuid NOT NULL REFERENCES buyer_entity_prefixes(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_buyer_entities_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_buyer_entities_prefix_id
    ON buyer_entities (prefix_id, name);

CREATE INDEX IF NOT EXISTS idx_buyer_entities_name_trgm
    ON buyer_entities USING gin (name gin_trgm_ops);

-- migrate:down

DROP TABLE IF EXISTS buyer_entities;
DROP TABLE IF EXISTS buyer_entity_prefixes;

-- migrate:up

ALTER TABLE new_contracts ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT FALSE;

-- migrate:down

ALTER TABLE new_contracts DROP COLUMN IF EXISTS is_service;
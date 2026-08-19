-- migrate:up

ALTER TABLE contract_lists
ADD COLUMN IF NOT EXISTS is_get BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE contract_lists
SET is_get = TRUE
WHERE pages IN (500, 1000);

-- migrate:down

ALTER TABLE contract_lists
DROP COLUMN IF EXISTS is_get;


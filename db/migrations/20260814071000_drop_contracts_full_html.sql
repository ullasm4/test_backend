-- migrate:up

ALTER TABLE contracts DROP COLUMN IF EXISTS full_html;

-- migrate:down

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS full_html TEXT;

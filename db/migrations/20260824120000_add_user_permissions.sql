-- migrate:up

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '["dashboard", "contracts", "sellers", "buyers", "whatsapp", "email", "ministries"]'::jsonb;

UPDATE users
SET permissions = '["dashboard", "contracts", "sellers", "buyers", "whatsapp", "email", "ministries", "users"]'::jsonb
WHERE role = 'admin';

-- migrate:down

ALTER TABLE users DROP COLUMN IF EXISTS permissions;

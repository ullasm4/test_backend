-- migrate:up

-- If an older `users` table already exists, `001_create_users_table.sql`
-- won't modify it (CREATE TABLE IF NOT EXISTS). This migration brings it
-- up to the expected shape for seeding and queries.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name VARCHAR(255);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(100) NOT NULL DEFAULT 'user';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Backfill for existing rows if columns were newly added.
UPDATE users
SET
  name = COALESCE(name, 'Unknown'),
  email = COALESCE(email, CONCAT('user-', id, '@example.com'))
WHERE name IS NULL OR email IS NULL;

-- Ensure uniqueness & index on email (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- migrate:down

-- We do not drop columns on down; keep schema stable.


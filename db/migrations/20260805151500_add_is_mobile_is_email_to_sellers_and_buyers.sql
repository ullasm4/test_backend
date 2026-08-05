-- migrate:up

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_email BOOLEAN DEFAULT false;

ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_email BOOLEAN DEFAULT false;

-- Backfill sellers
UPDATE sellers
SET is_mobile = (phone IS NOT NULL AND TRIM(phone) <> ''),
    is_email = (email IS NOT NULL AND TRIM(email) <> '');

-- Backfill buyers
UPDATE buyers
SET is_mobile = (phone IS NOT NULL AND TRIM(phone) <> ''),
    is_email = (email IS NOT NULL AND TRIM(email) <> '');

-- Create Indexes for super fast filtering
CREATE INDEX IF NOT EXISTS idx_sellers_is_mobile ON sellers (is_mobile);
CREATE INDEX IF NOT EXISTS idx_sellers_is_email ON sellers (is_email);
CREATE INDEX IF NOT EXISTS idx_buyers_is_mobile ON buyers (is_mobile);
CREATE INDEX IF NOT EXISTS idx_buyers_is_email ON buyers (is_email);

-- migrate:down

DROP INDEX IF EXISTS idx_sellers_is_mobile;
DROP INDEX IF EXISTS idx_sellers_is_email;
DROP INDEX IF EXISTS idx_buyers_is_mobile;
DROP INDEX IF EXISTS idx_buyers_is_email;

ALTER TABLE sellers
  DROP COLUMN IF EXISTS is_mobile,
  DROP COLUMN IF EXISTS is_email;

ALTER TABLE buyers
  DROP COLUMN IF EXISTS is_mobile,
  DROP COLUMN IF EXISTS is_email;

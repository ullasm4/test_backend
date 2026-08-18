-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Default unique list: DISTINCT ON / GROUP BY (name, phone, email) + latest created_at
CREATE INDEX IF NOT EXISTS idx_sellers_unique_identity_created
  ON sellers (
    LOWER(BTRIM(COALESCE(company_name, ''))),
    LOWER(BTRIM(COALESCE(phone, ''))),
    LOWER(BTRIM(COALESCE(email, ''))),
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_buyers_unique_identity_created
  ON buyers (
    LOWER(BTRIM(COALESCE(company_name, ''))),
    LOWER(BTRIM(COALESCE(phone, ''))),
    LOWER(BTRIM(COALESCE(email, ''))),
    created_at DESC
  );

-- Unique phone / email filters
CREATE INDEX IF NOT EXISTS idx_sellers_unique_phone_created
  ON sellers (phone, created_at DESC)
  WHERE is_mobile = true;

CREATE INDEX IF NOT EXISTS idx_sellers_unique_email_created
  ON sellers (email, created_at DESC)
  WHERE is_email = true;

CREATE INDEX IF NOT EXISTS idx_buyers_unique_phone_created
  ON buyers (LOWER(BTRIM(COALESCE(phone, ''))), created_at DESC)
  WHERE is_mobile = true;

CREATE INDEX IF NOT EXISTS idx_buyers_unique_email_created
  ON buyers (LOWER(BTRIM(COALESCE(email, ''))), created_at DESC)
  WHERE is_email = true;

-- Unique GST filter
CREATE INDEX IF NOT EXISTS idx_sellers_unique_gst_created
  ON sellers (LOWER(BTRIM(gst_number)), created_at DESC)
  WHERE gst_number IS NOT NULL AND gst_number <> '';

CREATE INDEX IF NOT EXISTS idx_buyers_unique_gst_created
  ON buyers (LOWER(BTRIM(gst_number)), created_at DESC)
  WHERE gst_number IS NOT NULL AND gst_number <> '';

-- State prefix (LIKE '27%') + GST search
CREATE INDEX IF NOT EXISTS idx_sellers_gst_prefix
  ON sellers (gst_number text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_sellers_gst_number_trgm
  ON sellers USING gin (gst_number gin_trgm_ops);

-- migrate:down

DROP INDEX IF EXISTS idx_sellers_gst_number_trgm;
DROP INDEX IF EXISTS idx_sellers_gst_prefix;
DROP INDEX IF EXISTS idx_buyers_unique_gst_created;
DROP INDEX IF EXISTS idx_sellers_unique_gst_created;
DROP INDEX IF EXISTS idx_buyers_unique_email_created;
DROP INDEX IF EXISTS idx_buyers_unique_phone_created;
DROP INDEX IF EXISTS idx_sellers_unique_email_created;
DROP INDEX IF EXISTS idx_sellers_unique_phone_created;
DROP INDEX IF EXISTS idx_buyers_unique_identity_created;
DROP INDEX IF EXISTS idx_sellers_unique_identity_created;

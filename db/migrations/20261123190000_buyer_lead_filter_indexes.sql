-- migrate:up
CREATE INDEX IF NOT EXISTS idx_buyer_lead_sr_no ON public.buyer_lead (sr_no ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_present
  ON public.buyer_lead (id)
  WHERE phone IS NOT NULL AND BTRIM(phone) <> '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_missing
  ON public.buyer_lead (id)
  WHERE phone IS NULL OR BTRIM(phone) = '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_present
  ON public.buyer_lead (id)
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_missing
  ON public.buyer_lead (id)
  WHERE email IS NULL OR BTRIM(email) = '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_website_present
  ON public.buyer_lead (id)
  WHERE website IS NOT NULL AND BTRIM(website) <> '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_website_missing
  ON public.buyer_lead (id)
  WHERE website IS NULL OR BTRIM(website) = '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_unique_key
  ON public.buyer_lead (LOWER(BTRIM(phone)))
  WHERE phone IS NOT NULL AND BTRIM(phone) <> '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_unique_key
  ON public.buyer_lead (LOWER(BTRIM(email)))
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_buyer_lead_name_trgm
  ON public.buyer_lead USING gin (name gin_trgm_ops);

-- migrate:down
DROP INDEX IF EXISTS public.idx_buyer_lead_name_trgm;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_unique_key;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_unique_key;
DROP INDEX IF EXISTS public.idx_buyer_lead_website_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_website_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_sr_no;

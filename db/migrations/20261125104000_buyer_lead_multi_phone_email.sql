-- migrate:up
DROP INDEX IF EXISTS public.idx_buyer_lead_email_unique;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_unique_key;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_unique_key;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone;
DROP INDEX IF EXISTS public.idx_buyer_lead_email;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_missing;

ALTER TABLE public.buyer_lead
  ADD COLUMN IF NOT EXISTS phone_list text[],
  ADD COLUMN IF NOT EXISTS email_list text[];

UPDATE public.buyer_lead
SET
  phone_list = CASE
    WHEN phone IS NULL OR BTRIM(phone::text) = '' THEN NULL
    ELSE ARRAY[BTRIM(phone::text)]
  END,
  email_list = CASE
    WHEN email IS NULL OR BTRIM(email::text) = '' THEN NULL
    ELSE ARRAY[BTRIM(email::text)]
  END
WHERE phone_list IS NULL AND email_list IS NULL;

ALTER TABLE public.buyer_lead DROP COLUMN IF EXISTS phone;
ALTER TABLE public.buyer_lead DROP COLUMN IF EXISTS email;

ALTER TABLE public.buyer_lead RENAME COLUMN phone_list TO phone;
ALTER TABLE public.buyer_lead RENAME COLUMN email_list TO email;

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_gin ON public.buyer_lead USING gin (phone);
CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_gin ON public.buyer_lead USING gin (email);

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_present
  ON public.buyer_lead (id)
  WHERE phone IS NOT NULL AND cardinality(phone) > 0;

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone_missing
  ON public.buyer_lead (id)
  WHERE phone IS NULL OR cardinality(phone) = 0;

CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_present
  ON public.buyer_lead (id)
  WHERE email IS NOT NULL AND cardinality(email) > 0;

CREATE INDEX IF NOT EXISTS idx_buyer_lead_email_missing
  ON public.buyer_lead (id)
  WHERE email IS NULL OR cardinality(email) = 0;

-- migrate:down
DROP INDEX IF EXISTS public.idx_buyer_lead_email_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_missing;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_present;
DROP INDEX IF EXISTS public.idx_buyer_lead_email_gin;
DROP INDEX IF EXISTS public.idx_buyer_lead_phone_gin;

ALTER TABLE public.buyer_lead
  ADD COLUMN IF NOT EXISTS phone_text text,
  ADD COLUMN IF NOT EXISTS email_text text;

UPDATE public.buyer_lead
SET
  phone_text = CASE WHEN phone IS NULL OR cardinality(phone) = 0 THEN NULL ELSE phone[1] END,
  email_text = CASE WHEN email IS NULL OR cardinality(email) = 0 THEN NULL ELSE email[1] END;

ALTER TABLE public.buyer_lead DROP COLUMN IF EXISTS phone;
ALTER TABLE public.buyer_lead DROP COLUMN IF EXISTS email;
ALTER TABLE public.buyer_lead RENAME COLUMN phone_text TO phone;
ALTER TABLE public.buyer_lead RENAME COLUMN email_text TO email;

CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone ON public.buyer_lead (phone);
CREATE INDEX IF NOT EXISTS idx_buyer_lead_email ON public.buyer_lead (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_lead_email_unique
  ON public.buyer_lead (LOWER(BTRIM(email)))
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

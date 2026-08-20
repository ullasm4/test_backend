-- migrate:up

ALTER TABLE public.seller_email_log
  ALTER COLUMN seller_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_email_log_email
  ON public.seller_email_log (LOWER(BTRIM(email)));

-- migrate:down

DROP INDEX IF EXISTS idx_seller_email_log_email;

ALTER TABLE public.seller_email_log
  ALTER COLUMN seller_id SET NOT NULL;

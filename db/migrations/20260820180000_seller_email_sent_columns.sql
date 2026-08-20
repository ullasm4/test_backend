-- migrate:up

ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_new_seller_details_email_unsent
  ON public.new_seller_details (id)
  WHERE email_sent IS NOT TRUE;

-- migrate:down

DROP INDEX IF EXISTS idx_new_seller_details_email_unsent;

ALTER TABLE public.new_seller_details
  DROP COLUMN IF EXISTS email_sent_at,
  DROP COLUMN IF EXISTS email_sent;

-- migrate:up

DROP INDEX IF EXISTS idx_seller_email_bulk_job_status;
DROP TABLE IF EXISTS public.seller_email_bulk_job;
DROP INDEX IF EXISTS idx_seller_email_log_seller_id;
DROP INDEX IF EXISTS idx_seller_email_log_sent_at;
DROP TABLE IF EXISTS public.seller_email_log;
DROP INDEX IF EXISTS idx_new_seller_details_email_unsent;
ALTER TABLE public.new_seller_details
  DROP COLUMN IF EXISTS email_sent_at,
  DROP COLUMN IF EXISTS email_sent;

-- migrate:down

ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_new_seller_details_email_unsent
  ON public.new_seller_details (id)
  WHERE email_sent IS NOT TRUE;

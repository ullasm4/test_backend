-- migrate:up

CREATE INDEX IF NOT EXISTS idx_seller_email_log_email_sent_at
  ON public.seller_email_log (LOWER(BTRIM(email)), sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_email_log_seller_sent_at
  ON public.seller_email_log (seller_id, sent_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_seller_email_log_seller_sent_at;
DROP INDEX IF EXISTS idx_seller_email_log_email_sent_at;

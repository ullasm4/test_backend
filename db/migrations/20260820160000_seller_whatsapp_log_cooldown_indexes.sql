-- migrate:up

CREATE INDEX IF NOT EXISTS idx_seller_whatsapp_log_destination_sent_at
  ON public.seller_whatsapp_log (destination, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_whatsapp_log_seller_sent_at
  ON public.seller_whatsapp_log (seller_id, sent_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_seller_whatsapp_log_seller_sent_at;
DROP INDEX IF EXISTS idx_seller_whatsapp_log_destination_sent_at;

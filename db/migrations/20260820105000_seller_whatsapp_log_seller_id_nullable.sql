-- migrate:up

ALTER TABLE public.seller_whatsapp_log
  ALTER COLUMN seller_id DROP NOT NULL;

-- migrate:down

DELETE FROM public.seller_whatsapp_log WHERE seller_id IS NULL;

ALTER TABLE public.seller_whatsapp_log
  ALTER COLUMN seller_id SET NOT NULL;

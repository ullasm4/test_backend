-- migrate:up

CREATE TABLE IF NOT EXISTS public.seller_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.new_seller_details(id),
  gem_seller_id VARCHAR(255),
  company_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  subject TEXT,
  source VARCHAR(64) NOT NULL DEFAULT 'email-direct',
  response_payload JSONB,
  sent_by UUID REFERENCES public.users(id),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_email_log_sent_at
  ON public.seller_email_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_email_log_seller_id
  ON public.seller_email_log (seller_id);

-- migrate:down

DROP INDEX IF EXISTS idx_seller_email_log_seller_id;
DROP INDEX IF EXISTS idx_seller_email_log_sent_at;
DROP TABLE IF EXISTS public.seller_email_log;


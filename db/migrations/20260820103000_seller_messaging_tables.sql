-- migrate:up

CREATE OR REPLACE FUNCTION public.seller_mobile_digits(phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d ~ '^[6-9][0-9]{9}$' THEN d
    WHEN d ~ '^0[6-9][0-9]{9}$' THEN substring(d from 2)
    WHEN d ~ '^91[6-9][0-9]{9}$' THEN substring(d from 3)
    ELSE NULL
  END
  FROM (SELECT regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_new_seller_details_whatsapp_unsent
  ON public.new_seller_details (id)
  WHERE whatsapp_sent IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_new_seller_details_email_unsent
  ON public.new_seller_details (id)
  WHERE email_sent IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_new_seller_information_valid_mobile
  ON public.new_seller_information (seller_id)
  WHERE public.seller_mobile_digits(phone) IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.seller_whatsapp_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.new_seller_details(id),
  gem_seller_id VARCHAR(255),
  company_name VARCHAR(255),
  destination VARCHAR(32) NOT NULL,
  phone VARCHAR(32),
  campaign_name VARCHAR(255),
  source VARCHAR(64) NOT NULL DEFAULT 'whatsapp-bulk',
  response_payload JSONB,
  sent_by UUID REFERENCES public.users(id),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_whatsapp_log_sent_at
  ON public.seller_whatsapp_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_whatsapp_log_seller_id
  ON public.seller_whatsapp_log (seller_id);

CREATE TABLE IF NOT EXISTS public.seller_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.new_seller_details(id),
  gem_seller_id VARCHAR(255),
  company_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  subject TEXT,
  source VARCHAR(64) NOT NULL DEFAULT 'email-bulk',
  response_payload JSONB,
  sent_by UUID REFERENCES public.users(id),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_email_log_sent_at
  ON public.seller_email_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_email_log_seller_id
  ON public.seller_email_log (seller_id);

CREATE TABLE IF NOT EXISTS public.seller_whatsapp_bulk_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(32) NOT NULL DEFAULT 'idle',
  daily_limit INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  processed_seller_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  last_company_name TEXT,
  last_destination VARCHAR(32),
  last_error TEXT,
  started_by UUID REFERENCES public.users(id),
  started_at TIMESTAMP WITH TIME ZONE,
  stopped_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_whatsapp_bulk_job_status
  ON public.seller_whatsapp_bulk_job (status);

CREATE TABLE IF NOT EXISTS public.seller_email_bulk_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(32) NOT NULL DEFAULT 'idle',
  daily_limit INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  processed_seller_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  last_company_name TEXT,
  last_destination VARCHAR(255),
  last_error TEXT,
  started_by UUID REFERENCES public.users(id),
  started_at TIMESTAMP WITH TIME ZONE,
  stopped_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_email_bulk_job_status
  ON public.seller_email_bulk_job (status);

-- migrate:down

DROP INDEX IF EXISTS idx_seller_email_bulk_job_status;
DROP TABLE IF EXISTS public.seller_email_bulk_job;
DROP INDEX IF EXISTS idx_seller_whatsapp_bulk_job_status;
DROP TABLE IF EXISTS public.seller_whatsapp_bulk_job;
DROP INDEX IF EXISTS idx_seller_email_log_seller_id;
DROP INDEX IF EXISTS idx_seller_email_log_sent_at;
DROP TABLE IF EXISTS public.seller_email_log;
DROP INDEX IF EXISTS idx_seller_whatsapp_log_seller_id;
DROP INDEX IF EXISTS idx_seller_whatsapp_log_sent_at;
DROP TABLE IF EXISTS public.seller_whatsapp_log;
DROP INDEX IF EXISTS idx_new_seller_information_valid_mobile;
DROP INDEX IF EXISTS idx_new_seller_details_email_unsent;
DROP INDEX IF EXISTS idx_new_seller_details_whatsapp_unsent;
ALTER TABLE public.new_seller_details
  DROP COLUMN IF EXISTS email_sent_at,
  DROP COLUMN IF EXISTS email_sent,
  DROP COLUMN IF EXISTS whatsapp_sent_at,
  DROP COLUMN IF EXISTS whatsapp_sent;
DROP FUNCTION IF EXISTS public.seller_mobile_digits(text);

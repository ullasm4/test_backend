-- migrate:up

CREATE TABLE IF NOT EXISTS public.brevo_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  message_id VARCHAR(255),
  subject TEXT,
  reason TEXT,
  event_timestamp TIMESTAMP WITH TIME ZONE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_log_email
  ON public.brevo_webhook_log (email);

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_log_event_type
  ON public.brevo_webhook_log (event_type);

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_log_created_at
  ON public.brevo_webhook_log (created_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_brevo_webhook_log_created_at;
DROP INDEX IF EXISTS idx_brevo_webhook_log_event_type;
DROP INDEX IF EXISTS idx_brevo_webhook_log_email;
DROP TABLE IF EXISTS public.brevo_webhook_log;

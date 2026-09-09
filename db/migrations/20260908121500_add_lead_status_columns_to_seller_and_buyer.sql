-- migrate:up
-- Add status columns. Requires no long-running dump (pg_dump/COPY) holding locks.
-- Fails fast via lock_timeout so APIs do not freeze.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS status VARCHAR(32);

ALTER TABLE public.new_seller_details
  ALTER COLUMN status SET DEFAULT 'new';

ALTER TABLE public.new_buyer_details
  ADD COLUMN IF NOT EXISTS status VARCHAR(32);

ALTER TABLE public.new_buyer_details
  ALTER COLUMN status SET DEFAULT 'new';

-- migrate:down

ALTER TABLE public.new_buyer_details DROP COLUMN IF EXISTS status;
ALTER TABLE public.new_seller_details DROP COLUMN IF EXISTS status;

-- migrate:up
CREATE TABLE IF NOT EXISTS public.buyer_lead (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sr_no integer,
  name text NOT NULL,
  phone text,
  email text,
  website text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buyer_lead_name ON public.buyer_lead (name);
CREATE INDEX IF NOT EXISTS idx_buyer_lead_phone ON public.buyer_lead (phone);
CREATE INDEX IF NOT EXISTS idx_buyer_lead_email ON public.buyer_lead (email);
CREATE INDEX IF NOT EXISTS idx_buyer_lead_created_at ON public.buyer_lead (created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS public.buyer_lead CASCADE;

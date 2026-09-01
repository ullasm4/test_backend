-- migrate:up

CREATE TYPE public.listing_type AS ENUM ('product', 'service', 'productorservice');

ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS type public.listing_type NOT NULL DEFAULT 'product'::public.listing_type;

-- migrate:down

ALTER TABLE public.new_seller_details   
  DROP COLUMN IF EXISTS type;

DROP TYPE IF EXISTS public.listing_type;
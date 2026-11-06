-- migrate:up
CREATE TABLE IF NOT EXISTS public.seller_remarks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.new_seller_details(id) ON DELETE CASCADE,
  remark text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seller_remarks_seller_id_created_at
  ON public.seller_remarks (seller_id, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS public.seller_remarks CASCADE;

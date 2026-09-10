-- migrate:up

CREATE TABLE IF NOT EXISTS public.follow_ups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid REFERENCES public.new_seller_details(id),
    buyer_id uuid REFERENCES public.new_buyer_details(id),
    date DATE NOT NULL,
    remark TEXT,
    created_by uuid,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT follow_ups_one_entity_chk CHECK (
      (seller_id IS NOT NULL AND buyer_id IS NULL)
      OR (seller_id IS NULL AND buyer_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_seller_id_date
  ON public.follow_ups (seller_id, date DESC)
  WHERE seller_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_buyer_id_date
  ON public.follow_ups (buyer_id, date DESC)
  WHERE buyer_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS public.idx_follow_ups_buyer_id_date;
DROP INDEX IF EXISTS public.idx_follow_ups_seller_id_date;
DROP TABLE IF EXISTS public.follow_ups;

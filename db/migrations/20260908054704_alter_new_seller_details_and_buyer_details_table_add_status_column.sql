-- migrate:up
-- History tables only (no lock on large seller/buyer tables).

CREATE TABLE IF NOT EXISTS public.seller_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seller_status_history_seller_id_changed_at
  ON public.seller_status_history (seller_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.buyer_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_buyer_status_history_buyer_id_changed_at
  ON public.buyer_status_history (buyer_id, changed_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_buyer_status_history_buyer_id_changed_at;
DROP TABLE IF EXISTS public.buyer_status_history;

DROP INDEX IF EXISTS idx_seller_status_history_seller_id_changed_at;
DROP TABLE IF EXISTS public.seller_status_history;

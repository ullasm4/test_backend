-- migrate:up
ALTER TABLE public.new_seller_details
  ADD COLUMN IF NOT EXISTS won_status character varying(32);

-- Copy outcome values into won_status without clearing the existing status column.
UPDATE public.new_seller_details
SET won_status = status
WHERE status IN ('won', 'lost', 'not_interested', 'invalid', 'other')
  AND won_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_new_seller_details_won_status
  ON public.new_seller_details (won_status);

-- migrate:down
DROP INDEX IF EXISTS public.idx_new_seller_details_won_status;

ALTER TABLE public.new_seller_details
  DROP COLUMN IF EXISTS won_status;

-- migrate:up

-- Speeds up seller list filter gst_type (GSTIN 4th char = PAN entity type: C/P/H/…)
CREATE INDEX IF NOT EXISTS idx_new_seller_information_gst_type_seller
  ON public.new_seller_information (
    (UPPER(SUBSTRING(BTRIM(gst_number) FROM 4 FOR 1))),
    seller_id
  )
  WHERE gst_number IS NOT NULL
    AND BTRIM(gst_number) <> ''
    AND LENGTH(BTRIM(gst_number)) >= 4;

-- migrate:down

DROP INDEX IF EXISTS idx_new_seller_information_gst_type_seller;

-- migrate:up
-- Keep one row per email (lowest sr_no, then oldest created_at), delete duplicates.
DELETE FROM public.buyer_lead bl
USING public.buyer_lead keep
WHERE bl.email IS NOT NULL
  AND BTRIM(bl.email) <> ''
  AND keep.email IS NOT NULL
  AND BTRIM(keep.email) <> ''
  AND LOWER(BTRIM(bl.email)) = LOWER(BTRIM(keep.email))
  AND (
    COALESCE(keep.sr_no, 2147483647) < COALESCE(bl.sr_no, 2147483647)
    OR (
      COALESCE(keep.sr_no, 2147483647) = COALESCE(bl.sr_no, 2147483647)
      AND keep.created_at < bl.created_at
    )
    OR (
      COALESCE(keep.sr_no, 2147483647) = COALESCE(bl.sr_no, 2147483647)
      AND keep.created_at = bl.created_at
      AND keep.id < bl.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_lead_email_unique
  ON public.buyer_lead (LOWER(BTRIM(email)))
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

-- migrate:down
DROP INDEX IF EXISTS public.idx_buyer_lead_email_unique;

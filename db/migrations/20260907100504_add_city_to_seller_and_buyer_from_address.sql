-- migrate:up

-- Add city columns for seller contacts + buyers.
-- City values are filled by:
--   1) trigger (after cities table exists + match function migration)
--   2) script: node src/scripts/backfillCityFromAddress.js
--
-- Do not bulk-parse here; cities lookup table is created in a later migration.

ALTER TABLE new_seller_information
  ADD COLUMN IF NOT EXISTS city VARCHAR(255);

ALTER TABLE new_buyer_details
  ADD COLUMN IF NOT EXISTS city VARCHAR(255);

-- Placeholder until cities-based matcher is installed.
CREATE OR REPLACE FUNCTION public.extract_city_from_address(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT NULL::text;
$fn$;

CREATE OR REPLACE FUNCTION public.set_city_from_address()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.address IS DISTINCT FROM OLD.address THEN
    NEW.city := public.extract_city_from_address(NEW.address);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;
CREATE TRIGGER trg_new_seller_information_set_city
BEFORE INSERT OR UPDATE OF address ON new_seller_information
FOR EACH ROW
EXECUTE FUNCTION public.set_city_from_address();

DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;
CREATE TRIGGER trg_new_buyer_details_set_city
BEFORE INSERT OR UPDATE OF address ON new_buyer_details
FOR EACH ROW
EXECUTE FUNCTION public.set_city_from_address();

CREATE INDEX IF NOT EXISTS idx_new_seller_information_city_lower
  ON new_seller_information (lower(btrim(city)))
  WHERE city IS NOT NULL AND btrim(city) <> '';

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_city_lower
  ON new_buyer_details (lower(btrim(city)))
  WHERE city IS NOT NULL AND btrim(city) <> '';

-- migrate:down

DROP INDEX IF EXISTS idx_new_buyer_details_city_lower;
DROP INDEX IF EXISTS idx_new_seller_information_city_lower;

DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;
DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;

ALTER TABLE new_buyer_details DROP COLUMN IF EXISTS city;
ALTER TABLE new_seller_information DROP COLUMN IF EXISTS city;

DROP FUNCTION IF EXISTS public.set_city_from_address();
DROP FUNCTION IF EXISTS public.extract_city_from_address(text);

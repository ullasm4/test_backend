-- migrate:up

-- Replace denormalized city text with city_id FK to public.cities.
-- Data backfill is intentionally NOT done here (too slow on ~200k rows).
-- After this migration, run: npm run backfill:city

DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;
DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;

ALTER TABLE new_seller_information
  ADD COLUMN IF NOT EXISTS city_id UUID;

ALTER TABLE new_buyer_details
  ADD COLUMN IF NOT EXISTS city_id UUID;

-- Fast path only: copy already-parsed text city -> city_id by name match.
UPDATE new_seller_information si
SET city_id = c.id
FROM (
  SELECT DISTINCT ON (lower(btrim(name)))
    id,
    lower(btrim(name)) AS name_key
  FROM cities
  ORDER BY lower(btrim(name)), length(name) DESC, id
) c
WHERE si.city_id IS NULL
  AND si.city IS NOT NULL
  AND BTRIM(si.city) <> ''
  AND lower(btrim(si.city)) = c.name_key;

UPDATE new_buyer_details b
SET city_id = c.id
FROM (
  SELECT DISTINCT ON (lower(btrim(name)))
    id,
    lower(btrim(name)) AS name_key
  FROM cities
  ORDER BY lower(btrim(name)), length(name) DESC, id
) c
WHERE b.city_id IS NULL
  AND b.city IS NOT NULL
  AND BTRIM(b.city) <> ''
  AND lower(btrim(b.city)) = c.name_key;

-- Switch matcher to return cities.id (UUID).
DROP FUNCTION IF EXISTS public.extract_city_from_address(text);
DROP FUNCTION IF EXISTS public.match_city_from_address(text);

CREATE OR REPLACE FUNCTION public.match_city_from_address(addr text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  cleaned text;
  result uuid;
BEGIN
  IF addr IS NULL OR BTRIM(addr) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := ' ' || BTRIM(public.normalize_address_for_city(addr)) || ' ';

  SELECT c.id
  INTO result
  FROM cities c
  WHERE cleaned LIKE
    '% ' || BTRIM(regexp_replace(lower(c.name), '[^a-z0-9]+', ' ', 'g')) || ' %'
  ORDER BY length(c.name) DESC, c.name ASC
  LIMIT 1;

  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.extract_city_from_address(addr text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT public.match_city_from_address(addr);
$fn$;

CREATE OR REPLACE FUNCTION public.set_city_from_address()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.address IS DISTINCT FROM OLD.address THEN
    NEW.city_id := public.match_city_from_address(NEW.address);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_new_seller_information_set_city
BEFORE INSERT OR UPDATE OF address ON new_seller_information
FOR EACH ROW
EXECUTE FUNCTION public.set_city_from_address();

CREATE TRIGGER trg_new_buyer_details_set_city
BEFORE INSERT OR UPDATE OF address ON new_buyer_details
FOR EACH ROW
EXECUTE FUNCTION public.set_city_from_address();

DROP INDEX IF EXISTS idx_new_seller_information_city_lower;
DROP INDEX IF EXISTS idx_new_buyer_details_city_lower;

ALTER TABLE new_seller_information DROP COLUMN IF EXISTS city;
ALTER TABLE new_buyer_details DROP COLUMN IF EXISTS city;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_new_seller_information_city_id'
  ) THEN
    ALTER TABLE new_seller_information
      ADD CONSTRAINT fk_new_seller_information_city_id
      FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_new_buyer_details_city_id'
  ) THEN
    ALTER TABLE new_buyer_details
      ADD CONSTRAINT fk_new_buyer_details_city_id
      FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_new_seller_information_city_id
  ON new_seller_information (city_id)
  WHERE city_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_city_id
  ON new_buyer_details (city_id)
  WHERE city_id IS NOT NULL;

-- migrate:down

DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;
DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;

DROP INDEX IF EXISTS idx_new_seller_information_city_id;
DROP INDEX IF EXISTS idx_new_buyer_details_city_id;

ALTER TABLE new_seller_information DROP CONSTRAINT IF EXISTS fk_new_seller_information_city_id;
ALTER TABLE new_buyer_details DROP CONSTRAINT IF EXISTS fk_new_buyer_details_city_id;

ALTER TABLE new_seller_information ADD COLUMN IF NOT EXISTS city VARCHAR(255);
ALTER TABLE new_buyer_details ADD COLUMN IF NOT EXISTS city VARCHAR(255);

UPDATE new_seller_information si
SET city = c.name
FROM cities c
WHERE si.city_id = c.id
  AND (si.city IS NULL OR BTRIM(si.city) = '');

UPDATE new_buyer_details b
SET city = c.name
FROM cities c
WHERE b.city_id = c.id
  AND (b.city IS NULL OR BTRIM(b.city) = '');

ALTER TABLE new_seller_information DROP COLUMN IF EXISTS city_id;
ALTER TABLE new_buyer_details DROP COLUMN IF EXISTS city_id;

DROP FUNCTION IF EXISTS public.extract_city_from_address(text);
DROP FUNCTION IF EXISTS public.match_city_from_address(text);

CREATE OR REPLACE FUNCTION public.match_city_from_address(addr text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  cleaned text;
  result text;
BEGIN
  IF addr IS NULL OR BTRIM(addr) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := ' ' || BTRIM(public.normalize_address_for_city(addr)) || ' ';

  SELECT c.name
  INTO result
  FROM cities c
  WHERE cleaned LIKE
    '% ' || BTRIM(regexp_replace(lower(c.name), '[^a-z0-9]+', ' ', 'g')) || ' %'
  ORDER BY length(c.name) DESC, c.name ASC
  LIMIT 1;

  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.extract_city_from_address(addr text)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT public.match_city_from_address(addr);
$fn$;

CREATE OR REPLACE FUNCTION public.set_city_from_address()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.address IS DISTINCT FROM OLD.address THEN
    NEW.city := public.match_city_from_address(NEW.address);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_new_seller_information_set_city
BEFORE INSERT OR UPDATE OF address ON new_seller_information
FOR EACH ROW
EXECUTE FUNCTION public.set_city_from_address();

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

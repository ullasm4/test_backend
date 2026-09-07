-- migrate:up

-- Match city from public.cities (longest name wins). Requires 20260907100505.
CREATE OR REPLACE FUNCTION public.normalize_address_for_city(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(addr, ''), 'bangalore', 'bengaluru', 'gi'),
                'bombay', 'mumbai', 'gi'
              ),
              'madras', 'chennai', 'gi'
            ),
            'calcutta', 'kolkata', 'gi'
          ),
          'gurugram', 'gurgaon', 'gi'
        ),
        'trivandrum', 'thiruvananthapuram', 'gi'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$fn$;

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

-- Keep old function name used by triggers, but switch to cities-table matching.
DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;
DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;

DROP FUNCTION IF EXISTS public.extract_city_from_address(text);

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

-- migrate:down

DROP TRIGGER IF EXISTS trg_new_seller_information_set_city ON new_seller_information;
DROP TRIGGER IF EXISTS trg_new_buyer_details_set_city ON new_buyer_details;

DROP FUNCTION IF EXISTS public.extract_city_from_address(text);
DROP FUNCTION IF EXISTS public.match_city_from_address(text);
DROP FUNCTION IF EXISTS public.normalize_address_for_city(text);

-- Restore lightweight stub so older trigger migration still works if re-applied out of order.
CREATE OR REPLACE FUNCTION public.extract_city_from_address(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT NULLIF(BTRIM(addr), '');
$fn$;

CREATE OR REPLACE FUNCTION public.set_city_from_address()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.address IS DISTINCT FROM OLD.address THEN
    NEW.city := NULL;
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

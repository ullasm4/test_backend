\restrict dbmate

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: listing_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_type AS ENUM (
    'product',
    'service',
    'productorservice'
);


--
-- Name: apply_contract_value_bucket_delta(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_contract_value_bucket_delta(old_bucket text, new_bucket text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF old_bucket IS NOT DISTINCT FROM new_bucket THEN
    RETURN;
  END IF;

  UPDATE total_counts
  SET
    value_0_50k = GREATEST(0, value_0_50k
      + CASE WHEN new_bucket = 'value_0_50k' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_0_50k' THEN 1 ELSE 0 END),
    value_50k_5l = GREATEST(0, value_50k_5l
      + CASE WHEN new_bucket = 'value_50k_5l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50k_5l' THEN 1 ELSE 0 END),
    value_5l_10l = GREATEST(0, value_5l_10l
      + CASE WHEN new_bucket = 'value_5l_10l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_5l_10l' THEN 1 ELSE 0 END),
    value_10l_50l = GREATEST(0, value_10l_50l
      + CASE WHEN new_bucket = 'value_10l_50l' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_10l_50l' THEN 1 ELSE 0 END),
    value_50l_1cr = GREATEST(0, value_50l_1cr
      + CASE WHEN new_bucket = 'value_50l_1cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50l_1cr' THEN 1 ELSE 0 END),
    value_1cr_5cr = GREATEST(0, value_1cr_5cr
      + CASE WHEN new_bucket = 'value_1cr_5cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_1cr_5cr' THEN 1 ELSE 0 END),
    value_5cr_10cr = GREATEST(0, value_5cr_10cr
      + CASE WHEN new_bucket = 'value_5cr_10cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_5cr_10cr' THEN 1 ELSE 0 END),
    value_10cr_50cr = GREATEST(0, value_10cr_50cr
      + CASE WHEN new_bucket = 'value_10cr_50cr' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_10cr_50cr' THEN 1 ELSE 0 END),
    value_50cr_plus = GREATEST(0, value_50cr_plus
      + CASE WHEN new_bucket = 'value_50cr_plus' THEN 1 ELSE 0 END
      - CASE WHEN old_bucket = 'value_50cr_plus' THEN 1 ELSE 0 END),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;
$$;


--
-- Name: apply_new_party_count_delta(uuid, uuid, bigint, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_new_party_count_delta(p_seller_id uuid, p_buyer_id uuid, p_contracts bigint, p_value numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_seller_id IS NOT NULL AND (p_contracts <> 0 OR COALESCE(p_value, 0) <> 0) THEN
    UPDATE new_seller_details
    SET total_contracts = GREATEST(0, total_contracts + p_contracts),
        total_value = GREATEST(0, total_value + COALESCE(p_value, 0))
    WHERE id = p_seller_id;
  END IF;

  IF p_buyer_id IS NOT NULL AND (p_contracts <> 0 OR COALESCE(p_value, 0) <> 0) THEN
    UPDATE new_buyer_details
    SET total_contracts = GREATEST(0, total_contracts + p_contracts),
        total_value = GREATEST(0, total_value + COALESCE(p_value, 0))
    WHERE id = p_buyer_id;
  END IF;
END;
$$;


--
-- Name: bump_contract_lookup(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_contract_lookup(p_kind text, p_name text, p_delta integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_name text := CASE
    WHEN p_kind = 'buying_mode' THEN normalize_buying_mode(p_name)
    ELSE contract_lookup_name(p_name)
  END;
BEGIN
  IF v_name IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;

  IF p_kind = 'organization' THEN
    IF p_delta > 0 THEN
      INSERT INTO organizations (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = organizations.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE organizations
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'organization_type' THEN
    IF p_delta > 0 THEN
      INSERT INTO organization_types (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = organization_types.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE organization_types
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'department' THEN
    IF p_delta > 0 THEN
      INSERT INTO departments (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = departments.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE departments
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  ELSIF p_kind = 'buying_mode' THEN
    IF p_delta > 0 THEN
      INSERT INTO buying_modes (name, total_contract)
      VALUES (v_name, p_delta)
      ON CONFLICT (name) DO UPDATE
        SET total_contract = buying_modes.total_contract + EXCLUDED.total_contract,
            updated_at = CURRENT_TIMESTAMP;
    ELSE
      UPDATE buying_modes
      SET total_contract = GREATEST(0, total_contract + p_delta),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = v_name;
    END IF;
  END IF;
END;
$$;


--
-- Name: buyer_identity_exists(character varying, character varying, character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.buyer_identity_exists(p_name character varying, p_phone character varying, p_email character varying, p_exclude uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM buyers b
    WHERE (p_exclude IS NULL OR b.id <> p_exclude)
      AND LOWER(BTRIM(COALESCE(b.company_name, ''))) = LOWER(BTRIM(COALESCE(p_name, '')))
      AND LOWER(BTRIM(COALESCE(b.phone, ''))) = LOWER(BTRIM(COALESCE(p_phone, '')))
      AND LOWER(BTRIM(COALESCE(b.email, ''))) = LOWER(BTRIM(COALESCE(p_email, '')))
  );
$$;


--
-- Name: buyer_identity_key(character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.buyer_identity_key(p_name character varying, p_phone character varying, p_email character varying) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT LOWER(BTRIM(COALESCE(p_name, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$;


--
-- Name: contract_bid_number_missing(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_bid_number_missing(v text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT v IS NULL OR BTRIM(v) = '';
$$;


--
-- Name: contract_bid_number_present(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_bid_number_present(v text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT v IS NOT NULL AND BTRIM(v) <> '';
$$;


--
-- Name: contract_lookup_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_lookup_name(p_name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF v_name IS NULL OR v_name ~* '^(?:[-–—.|]+|NA|N/A)$' THEN
    RETURN NULL;
  END IF;
  RETURN v_name;
END;
$_$;


--
-- Name: contract_value_bucket_column(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_value_bucket_column(v numeric) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  ELSIF v <= 50000 THEN
    RETURN 'value_0_50k';
  ELSIF v <= 500000 THEN
    RETURN 'value_50k_5l';
  ELSIF v <= 1000000 THEN
    RETURN 'value_5l_10l';
  ELSIF v <= 5000000 THEN
    RETURN 'value_10l_50l';
  ELSIF v <= 10000000 THEN
    RETURN 'value_50l_1cr';
  ELSIF v <= 50000000 THEN
    RETURN 'value_1cr_5cr';
  ELSIF v <= 100000000 THEN
    RETURN 'value_5cr_10cr';
  ELSIF v <= 500000000 THEN
    RETURN 'value_10cr_50cr';
  ELSE
    RETURN 'value_50cr_plus';
  END IF;
END;
$$;


--
-- Name: normalize_buying_mode(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_buying_mode(p_name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF v_name IS NULL OR v_name ~* '^(?:[-–—.|]+|NA|N/A)$' THEN
    RETURN NULL;
  END IF;

  IF lower(v_name) = 'bid/ra' THEN
    RETURN 'Bid/RA';
  END IF;

  RETURN v_name;
END;
$_$;


--
-- Name: refresh_new_table_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_new_table_counts() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE new_seller_details
  SET total_contracts = 0, total_value = 0;

  UPDATE new_seller_details nsd
  SET total_contracts = sub.cnt,
      total_value = sub.val
  FROM (
    SELECT seller_id,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(total_value), 0) AS val
    FROM new_contracts
    GROUP BY seller_id
  ) sub
  WHERE nsd.id = sub.seller_id;

  UPDATE new_buyer_details
  SET total_contracts = 0, total_value = 0;

  UPDATE new_buyer_details nbd
  SET total_contracts = sub.cnt,
      total_value = sub.val
  FROM (
    SELECT buyer_id,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(total_value), 0) AS val
    FROM new_contracts
    GROUP BY buyer_id
  ) sub
  WHERE nbd.id = sub.buyer_id;
END;
$$;


--
-- Name: seller_contact_key(character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_contact_key(p_phone character varying, p_email character varying) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$;


--
-- Name: seller_identity_exists(character varying, character varying, character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_identity_exists(p_name character varying, p_phone character varying, p_email character varying, p_exclude uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM sellers s
    WHERE (p_exclude IS NULL OR s.id <> p_exclude)
      AND LOWER(BTRIM(COALESCE(s.company_name, ''))) = LOWER(BTRIM(COALESCE(p_name, '')))
      AND LOWER(BTRIM(COALESCE(s.phone, ''))) = LOWER(BTRIM(COALESCE(p_phone, '')))
      AND LOWER(BTRIM(COALESCE(s.email, ''))) = LOWER(BTRIM(COALESCE(p_email, '')))
  );
$$;


--
-- Name: seller_identity_key(character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_identity_key(p_name character varying, p_phone character varying, p_email character varying) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT LOWER(BTRIM(COALESCE(p_name, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$;


--
-- Name: seller_mobile_digits(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_mobile_digits(phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT CASE
    WHEN d ~ '^[6-9][0-9]{9}$' THEN d
    WHEN d ~ '^0[6-9][0-9]{9}$' THEN substring(d from 2)
    WHEN d ~ '^91[6-9][0-9]{9}$' THEN substring(d from 3)
    ELSE NULL
  END
  FROM (SELECT regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS d) s;
$_$;


--
-- Name: set_is_mobile_is_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_is_mobile_is_email() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.is_mobile := (NEW.phone IS NOT NULL AND TRIM(NEW.phone) <> '');
  NEW.is_email := (NEW.email IS NOT NULL AND TRIM(NEW.email) <> '');
  RETURN NEW;
END;
$$;


--
-- Name: sync_contract_lookups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_contract_lookups() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_contract_lookup('organization', NEW.org_name, 1);
    PERFORM bump_contract_lookup('organization_type', NEW.org_type, 1);
    PERFORM bump_contract_lookup('department', NEW.department, 1);
    PERFORM bump_contract_lookup('buying_mode', NEW.buying_mode, 1);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM bump_contract_lookup('organization', OLD.org_name, -1);
    PERFORM bump_contract_lookup('organization_type', OLD.org_type, -1);
    PERFORM bump_contract_lookup('department', OLD.department, -1);
    PERFORM bump_contract_lookup('buying_mode', OLD.buying_mode, -1);
    RETURN NULL;
  END IF;

  IF contract_lookup_name(NEW.org_name) IS DISTINCT FROM contract_lookup_name(OLD.org_name) THEN
    PERFORM bump_contract_lookup('organization', OLD.org_name, -1);
    PERFORM bump_contract_lookup('organization', NEW.org_name, 1);
  END IF;
  IF contract_lookup_name(NEW.org_type) IS DISTINCT FROM contract_lookup_name(OLD.org_type) THEN
    PERFORM bump_contract_lookup('organization_type', OLD.org_type, -1);
    PERFORM bump_contract_lookup('organization_type', NEW.org_type, 1);
  END IF;
  IF contract_lookup_name(NEW.department) IS DISTINCT FROM contract_lookup_name(OLD.department) THEN
    PERFORM bump_contract_lookup('department', OLD.department, -1);
    PERFORM bump_contract_lookup('department', NEW.department, 1);
  END IF;
  IF contract_lookup_name(NEW.buying_mode) IS DISTINCT FROM contract_lookup_name(OLD.buying_mode) THEN
    PERFORM bump_contract_lookup('buying_mode', OLD.buying_mode, -1);
    PERFORM bump_contract_lookup('buying_mode', NEW.buying_mode, 1);
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sync_old_contract_to_new_tables(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_old_contract_to_new_tables(p_contract_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_contract RECORD;
  v_seller RECORD;
  v_buyer RECORD;
  v_new_seller_id uuid;
  v_new_buyer_id uuid;
  v_gem_seller_id varchar;
BEGIN
  SELECT *
  INTO v_contract
  FROM contracts
  WHERE id = p_contract_id;

  IF NOT FOUND OR v_contract.ministry_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_seller
  FROM sellers
  WHERE contract_id = p_contract_id
    AND seller_id IS NOT NULL
    AND BTRIM(seller_id) <> ''
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1;

  SELECT *
  INTO v_buyer
  FROM buyers
  WHERE contract_id = p_contract_id
    AND (
      NULLIF(BTRIM(COALESCE(company_name, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL
    )
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1;

  IF v_seller IS NULL OR v_buyer IS NULL THEN
    DELETE FROM new_contracts WHERE id = p_contract_id;
    RETURN;
  END IF;

  v_gem_seller_id := BTRIM(v_seller.seller_id);

  INSERT INTO new_seller_details (seller_id, company_name, msme_certificate_number)
  VALUES (
    v_gem_seller_id,
    NULLIF(BTRIM(v_seller.company_name), ''),
    NULLIF(BTRIM(v_seller.msme_certificate_number), '')
  )
  ON CONFLICT (seller_id) DO UPDATE
    SET company_name = COALESCE(EXCLUDED.company_name, new_seller_details.company_name),
        msme_certificate_number = COALESCE(
          EXCLUDED.msme_certificate_number,
          new_seller_details.msme_certificate_number
        )
  RETURNING id INTO v_new_seller_id;

  INSERT INTO new_seller_information (seller_id, phone, email, address, gst_number)
  VALUES (
    v_new_seller_id,
    NULLIF(BTRIM(v_seller.phone), ''),
    NULLIF(BTRIM(v_seller.email), ''),
    NULLIF(BTRIM(v_seller.address), ''),
    NULLIF(BTRIM(v_seller.gst_number), '')
  )
  ON CONFLICT (seller_id, contact_key) DO UPDATE
    SET address = COALESCE(EXCLUDED.address, new_seller_information.address),
        gst_number = COALESCE(EXCLUDED.gst_number, new_seller_information.gst_number);

  INSERT INTO new_buyer_details (company_name, phone, email, address, gst_number)
  VALUES (
    NULLIF(BTRIM(v_buyer.company_name), ''),
    NULLIF(BTRIM(v_buyer.phone), ''),
    NULLIF(BTRIM(v_buyer.email), ''),
    NULLIF(BTRIM(v_buyer.address), ''),
    NULLIF(BTRIM(v_buyer.gst_number), '')
  )
  ON CONFLICT (identity_key) DO UPDATE
    SET address = COALESCE(EXCLUDED.address, new_buyer_details.address),
        gst_number = COALESCE(EXCLUDED.gst_number, new_buyer_details.gst_number)
  RETURNING id INTO v_new_buyer_id;

  INSERT INTO new_contracts (
    id, seller_id, buyer_id, ministry_id,
    contract_number, org_type, org_name, total_value,
    department, office_zone, status_of_the_contract,
    order_id, contract_pdf_url, financial_application,
    paying_authority, products, consinee_details,
    contract_date, created_at
  )
  VALUES (
    v_contract.id,
    v_new_seller_id,
    v_new_buyer_id,
    v_contract.ministry_id,
    v_contract.contract_number,
    v_contract.org_type,
    v_contract.org_name,
    v_contract.total_value,
    v_contract.department,
    v_contract.office_zone,
    v_contract.status_of_the_contract,
    v_contract.order_id,
    v_contract.contract_pdf_url,
    COALESCE(v_contract.financial_application, '{}'::jsonb),
    COALESCE(v_contract.paying_authority, '{}'::jsonb),
    COALESCE(v_contract.products, '{}'::jsonb),
    COALESCE(v_contract.consinee_details, '{}'::jsonb),
    v_contract.contract_date,
    v_contract.created_at
  )
  ON CONFLICT (id) DO UPDATE
    SET seller_id = EXCLUDED.seller_id,
        buyer_id = EXCLUDED.buyer_id,
        ministry_id = EXCLUDED.ministry_id,
        contract_number = EXCLUDED.contract_number,
        org_type = EXCLUDED.org_type,
        org_name = EXCLUDED.org_name,
        total_value = EXCLUDED.total_value,
        department = EXCLUDED.department,
        office_zone = EXCLUDED.office_zone,
        status_of_the_contract = EXCLUDED.status_of_the_contract,
        order_id = EXCLUDED.order_id,
        contract_pdf_url = EXCLUDED.contract_pdf_url,
        financial_application = EXCLUDED.financial_application,
        paying_authority = EXCLUDED.paying_authority,
        products = EXCLUDED.products,
        consinee_details = EXCLUDED.consinee_details,
        contract_date = EXCLUDED.contract_date;
END;
$$;


--
-- Name: sync_seller_id_to_contracts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_seller_id_to_contracts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL AND TRIM(NEW.seller_id) <> '' THEN
    UPDATE contracts
    SET seller_id = NEW.seller_id
    WHERE id = NEW.contract_id AND (seller_id IS NULL OR seller_id <> NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_sync_old_contract_to_new_tables(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_old_contract_to_new_tables() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM new_contracts WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM sync_old_contract_to_new_tables(NEW.id);
  RETURN NEW;
END;
$$;


--
-- Name: trg_sync_old_party_to_new_tables(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_old_party_to_new_tables() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- Keep unique seller/buyer master rows. Re-sync the contract if it still exists.
    IF OLD.contract_id IS NOT NULL THEN
      PERFORM sync_old_contract_to_new_tables(OLD.contract_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.contract_id IS NOT NULL THEN
    PERFORM sync_old_contract_to_new_tables(NEW.contract_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_buyers_with_email_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_buyers_with_email_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.is_email IS TRUE THEN
      UPDATE total_counts SET buyers_with_email = buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.is_email IS TRUE THEN
      UPDATE total_counts SET buyers_with_email = GREATEST(0, buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.is_email IS DISTINCT FROM OLD.is_email THEN
      UPDATE total_counts
      SET buyers_with_email = GREATEST(0, buyers_with_email
            + CASE WHEN NEW.is_email IS TRUE THEN 1 ELSE 0 END
            - CASE WHEN OLD.is_email IS TRUE THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_contract_value_bucket_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_contract_value_bucket_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM apply_contract_value_bucket_delta(NULL, contract_value_bucket_column(NEW.total_value));
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM apply_contract_value_bucket_delta(contract_value_bucket_column(OLD.total_value), NULL);
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.total_value IS DISTINCT FROM OLD.total_value THEN
      PERFORM apply_contract_value_bucket_delta(
        contract_value_bucket_column(OLD.total_value),
        contract_value_bucket_column(NEW.total_value)
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_contracts_bid_number_null_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_contracts_bid_number_null_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_missing boolean;
  new_missing boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF contract_bid_number_missing(NEW.bid_number) THEN
      UPDATE total_counts
      SET contracts_bid_number_null = contracts_bid_number_null + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF contract_bid_number_missing(OLD.bid_number) THEN
      UPDATE total_counts
      SET contracts_bid_number_null = GREATEST(0, contracts_bid_number_null - 1),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_missing := contract_bid_number_missing(OLD.bid_number);
    new_missing := contract_bid_number_missing(NEW.bid_number);
    IF old_missing IS DISTINCT FROM new_missing THEN
      UPDATE total_counts
      SET contracts_bid_number_null = GREATEST(0, contracts_bid_number_null
            + CASE WHEN new_missing THEN 1 ELSE 0 END
            - CASE WHEN old_missing THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_contracts_period_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_contracts_period_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  day_start TIMESTAMPTZ := DATE_TRUNC('day', NOW());
  week_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts
    SET contracts_today = contracts_today + CASE WHEN NEW.created_at >= day_start THEN 1 ELSE 0 END,
        contracts_week = contracts_week + CASE WHEN NEW.created_at >= week_start THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts
    SET contracts_today = GREATEST(0, contracts_today - CASE WHEN OLD.created_at >= day_start THEN 1 ELSE 0 END),
        contracts_week = GREATEST(0, contracts_week - CASE WHEN OLD.created_at >= week_start THEN 1 ELSE 0 END),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_ministry_total_contract(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ministry_total_contract() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE contract_ministry
        SET total_contract = total_contract + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.ministry_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE contract_ministry
        SET total_contract = GREATEST(0, total_contract - 1),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = OLD.ministry_id;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF NEW.ministry_id IS DISTINCT FROM OLD.ministry_id THEN
            UPDATE contract_ministry
            SET total_contract = GREATEST(0, total_contract - 1),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = OLD.ministry_id;

            UPDATE contract_ministry
            SET total_contract = total_contract + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.ministry_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_new_buyers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_buyers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_buyers = new_buyers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_buyers = GREATEST(0, new_buyers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_buyers_with_email_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_buyers_with_email_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.email IS NOT NULL AND BTRIM(NEW.email) <> '' THEN
      UPDATE total_counts SET new_buyers_with_email = new_buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.email IS NOT NULL AND BTRIM(OLD.email) <> '' THEN
      UPDATE total_counts SET new_buyers_with_email = GREATEST(0, new_buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      IF OLD.email IS NOT NULL AND BTRIM(OLD.email) <> '' THEN
        UPDATE total_counts SET new_buyers_with_email = GREATEST(0, new_buyers_with_email - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
      IF NEW.email IS NOT NULL AND BTRIM(NEW.email) <> '' THEN
        UPDATE total_counts SET new_buyers_with_email = new_buyers_with_email + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_contracts_bid_present_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_contracts_bid_present_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_present boolean;
  new_present boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF contract_bid_number_present(NEW.bid_number) THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = new_contracts_with_bid_number + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF contract_bid_number_present(OLD.bid_number) THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = GREATEST(0, new_contracts_with_bid_number - 1),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_present := contract_bid_number_present(OLD.bid_number);
    new_present := contract_bid_number_present(NEW.bid_number);
    IF old_present IS DISTINCT FROM new_present THEN
      UPDATE total_counts
      SET new_contracts_with_bid_number = GREATEST(0, new_contracts_with_bid_number
            + CASE WHEN new_present THEN 1 ELSE 0 END
            - CASE WHEN old_present THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_contracts_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_contracts_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_contracts = new_contracts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_contracts = GREATEST(0, new_contracts - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_party_counts_from_contracts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_party_counts_from_contracts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM apply_new_party_count_delta(NEW.seller_id, NEW.buyer_id, 1, NEW.total_value);
    RETURN NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM apply_new_party_count_delta(OLD.seller_id, OLD.buyer_id, -1, -COALESCE(OLD.total_value, 0));
    RETURN NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
       OR NEW.total_value IS DISTINCT FROM OLD.total_value THEN
      PERFORM apply_new_party_count_delta(OLD.seller_id, OLD.buyer_id, -1, -COALESCE(OLD.total_value, 0));
      PERFORM apply_new_party_count_delta(NEW.seller_id, NEW.buyer_id, 1, NEW.total_value);
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_sellers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_sellers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET new_sellers = new_sellers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET new_sellers = GREATEST(0, new_sellers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_new_sellers_with_phone_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_new_sellers_with_phone_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  has_phone boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    has_phone := (NEW.phone IS NOT NULL AND BTRIM(NEW.phone) <> '');
    IF has_phone THEN
      IF NOT EXISTS (
        SELECT 1 FROM new_seller_information
        WHERE seller_id = NEW.seller_id AND id <> NEW.id
          AND phone IS NOT NULL AND BTRIM(phone) <> ''
      ) THEN
        UPDATE total_counts SET new_sellers_with_phone = new_sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    has_phone := (OLD.phone IS NOT NULL AND BTRIM(OLD.phone) <> '');
    IF has_phone THEN
      IF NOT EXISTS (
        SELECT 1 FROM new_seller_information
        WHERE seller_id = OLD.seller_id
          AND phone IS NOT NULL AND BTRIM(phone) <> ''
      ) THEN
        UPDATE total_counts SET new_sellers_with_phone = GREATEST(0, new_sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      END IF;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (NEW.phone IS DISTINCT FROM OLD.phone) OR (NEW.seller_id IS DISTINCT FROM OLD.seller_id) THEN
      -- Check if old seller loses its last phone
      IF (OLD.phone IS NOT NULL AND BTRIM(OLD.phone) <> '') THEN
        IF NOT EXISTS (
          SELECT 1 FROM new_seller_information
          WHERE seller_id = OLD.seller_id AND id <> OLD.id
            AND phone IS NOT NULL AND BTRIM(phone) <> ''
        ) THEN
          UPDATE total_counts SET new_sellers_with_phone = GREATEST(0, new_sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
        END IF;
      END IF;
      -- Check if new seller gains its first phone
      IF (NEW.phone IS NOT NULL AND BTRIM(NEW.phone) <> '') THEN
        IF NOT EXISTS (
          SELECT 1 FROM new_seller_information
          WHERE seller_id = NEW.seller_id AND id <> NEW.id
            AND phone IS NOT NULL AND BTRIM(phone) <> ''
        ) THEN
          UPDATE total_counts SET new_sellers_with_phone = new_sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_sellers_with_phone_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_sellers_with_phone_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.is_mobile IS TRUE THEN
      UPDATE total_counts SET sellers_with_phone = sellers_with_phone + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.is_mobile IS TRUE THEN
      UPDATE total_counts SET sellers_with_phone = GREATEST(0, sellers_with_phone - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.is_mobile IS DISTINCT FROM OLD.is_mobile THEN
      UPDATE total_counts
      SET sellers_with_phone = GREATEST(0, sellers_with_phone
            + CASE WHEN NEW.is_mobile IS TRUE THEN 1 ELSE 0 END
            - CASE WHEN OLD.is_mobile IS TRUE THEN 1 ELSE 0 END),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_total_buyers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_total_buyers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_buyers = total_buyers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_buyers = GREATEST(0, total_buyers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_total_contracts_from_ministries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_total_contracts_from_ministries() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        UPDATE total_counts
        SET total_contracts = GREATEST(0, total_contracts + (COALESCE(NEW.total_contract, 0) - COALESCE(OLD.total_contract, 0))),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts
        SET total_contracts = GREATEST(0, total_contracts - COALESCE(OLD.total_contract, 0)),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_total_ministries_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_total_ministries_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE total_counts SET total_ministries = total_ministries + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE total_counts SET total_ministries = GREATEST(0, total_ministries - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_total_sellers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_total_sellers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE total_counts SET total_sellers = total_sellers + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE total_counts SET total_sellers = GREATEST(0, total_sellers - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_unique_buyers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_unique_buyers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_key text;
  new_key text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NOT buyer_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = unique_buyers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    IF NOT buyer_identity_exists(OLD.company_name, OLD.phone, OLD.email, NULL) THEN
      UPDATE total_counts
      SET unique_buyers = GREATEST(0, unique_buyers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_key := buyer_identity_key(OLD.company_name, OLD.phone, OLD.email);
    new_key := buyer_identity_key(NEW.company_name, NEW.phone, NEW.email);
    IF old_key = new_key THEN
      RETURN NULL;
    END IF;
    IF NOT buyer_identity_exists(OLD.company_name, OLD.phone, OLD.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = GREATEST(0, unique_buyers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    IF NOT buyer_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_buyers = unique_buyers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_unique_sellers_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_unique_sellers_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_key text;
  new_key text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NOT seller_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = unique_sellers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    IF NOT seller_identity_exists(OLD.company_name, OLD.phone, OLD.email, NULL) THEN
      UPDATE total_counts
      SET unique_sellers = GREATEST(0, unique_sellers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_key := seller_identity_key(OLD.company_name, OLD.phone, OLD.email);
    new_key := seller_identity_key(NEW.company_name, NEW.phone, NEW.email);
    IF old_key = new_key THEN
      RETURN NULL;
    END IF;
    IF NOT seller_identity_exists(OLD.company_name, OLD.phone, OLD.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = GREATEST(0, unique_sellers - 1), updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    IF NOT seller_identity_exists(NEW.company_name, NEW.phone, NEW.email, NEW.id) THEN
      UPDATE total_counts
      SET unique_sellers = unique_sellers + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: brevo_webhook_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brevo_webhook_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(64) NOT NULL,
    email character varying(255) NOT NULL,
    message_id character varying(255),
    subject text,
    reason text,
    event_timestamp timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: buying_modes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buying_modes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    total_contract bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: category_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_stats (
    category character varying(255) NOT NULL,
    seller_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: category_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_summary (
    category text NOT NULL,
    seller_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: contract_list_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_list_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    page integer NOT NULL,
    total_contracts integer NOT NULL,
    is_done boolean DEFAULT false NOT NULL,
    message text NOT NULL
);


--
-- Name: contract_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    pages integer DEFAULT 0 NOT NULL,
    total_contracts integer DEFAULT 0 NOT NULL,
    is_scrapped boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_get boolean DEFAULT false NOT NULL
);


--
-- Name: contract_ministry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_ministry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_contract bigint DEFAULT 0 NOT NULL
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    total_contract bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: new_buyer_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.new_buyer_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name character varying(255),
    phone character varying(255),
    email character varying(255),
    address text,
    gst_number character varying(255),
    total_contracts bigint DEFAULT 0 NOT NULL,
    total_value numeric(18,2) DEFAULT 0 NOT NULL,
    identity_key text GENERATED ALWAYS AS (public.buyer_identity_key(company_name, phone, email)) STORED
);


--
-- Name: new_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.new_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid,
    buyer_id uuid,
    ministry_id uuid,
    contract_number text,
    org_type text,
    org_name text,
    total_value numeric(18,2),
    department text,
    office_zone text,
    status_of_the_contract text,
    order_id text,
    contract_pdf_url text,
    financial_application jsonb DEFAULT '{}'::jsonb NOT NULL,
    paying_authority jsonb DEFAULT '{}'::jsonb NOT NULL,
    products jsonb DEFAULT '{}'::jsonb NOT NULL,
    consinee_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    contract_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    bid_number character varying(255),
    buyer_designation character varying(255),
    buying_mode character varying(255),
    state_id uuid,
    is_service boolean DEFAULT false
);


--
-- Name: new_seller_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.new_seller_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id character varying(255) NOT NULL,
    company_name character varying(255),
    msme_certificate_number character varying(255),
    total_contracts bigint DEFAULT 0 NOT NULL,
    total_value numeric(18,2) DEFAULT 0 NOT NULL,
    whatsapp_sent boolean DEFAULT false NOT NULL,
    whatsapp_sent_at timestamp with time zone,
    email_sent boolean DEFAULT false NOT NULL,
    email_sent_at timestamp with time zone,
    type public.listing_type DEFAULT 'product'::public.listing_type NOT NULL
);


--
-- Name: new_seller_information; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.new_seller_information (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    phone character varying(255),
    email character varying(255),
    address text,
    gst_number character varying(255),
    contact_key text GENERATED ALWAYS AS (public.seller_contact_key(phone, email)) STORED
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    seller_id uuid,
    message_id character varying(255),
    event_type character varying(64),
    webhook_log_id uuid
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: organization_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    total_contract bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    total_contract bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: seller_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_category (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id character varying(255) NOT NULL,
    category text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: seller_email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid,
    gem_seller_id character varying(255),
    company_name character varying(255),
    email character varying(255) NOT NULL,
    subject text,
    source character varying(64) DEFAULT 'email-direct'::character varying NOT NULL,
    response_payload jsonb,
    sent_by uuid,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: seller_whatsapp_bulk_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_whatsapp_bulk_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(32) DEFAULT 'idle'::character varying NOT NULL,
    daily_limit integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    processed_seller_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    last_company_name text,
    last_destination character varying(32),
    last_error text,
    started_by uuid,
    started_at timestamp with time zone,
    stopped_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: seller_whatsapp_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_whatsapp_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid,
    gem_seller_id character varying(255),
    company_name character varying(255),
    destination character varying(32) NOT NULL,
    phone character varying(32),
    campaign_name character varying(255),
    source character varying(64) DEFAULT 'whatsapp-bulk'::character varying NOT NULL,
    response_payload jsonb,
    sent_by uuid,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: state_wise_contract_list_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_wise_contract_list_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state_wise_contract_list_id uuid CONSTRAINT state_wise_contract_list_pa_state_wise_contract_list_i_not_null NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    page_number integer NOT NULL,
    total_contracts integer DEFAULT 0 NOT NULL,
    is_scraped boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: state_wise_contract_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_wise_contract_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state_id uuid NOT NULL,
    total_pages integer DEFAULT 0 NOT NULL,
    total_contracts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    gst_code character varying(2),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: total_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.total_counts (
    id integer DEFAULT 1 NOT NULL,
    total_contracts integer DEFAULT 0 NOT NULL,
    total_sellers integer DEFAULT 0 NOT NULL,
    total_buyers integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    sellers_with_phone bigint DEFAULT 0 NOT NULL,
    buyers_with_email bigint DEFAULT 0 NOT NULL,
    contracts_today bigint DEFAULT 0 NOT NULL,
    contracts_week bigint DEFAULT 0 NOT NULL,
    total_ministries bigint DEFAULT 0 NOT NULL,
    dashboard_day date,
    value_0_50k bigint DEFAULT 0 NOT NULL,
    value_50k_5l bigint DEFAULT 0 NOT NULL,
    value_5l_10l bigint DEFAULT 0 NOT NULL,
    value_10l_50l bigint DEFAULT 0 NOT NULL,
    value_50l_1cr bigint DEFAULT 0 NOT NULL,
    value_1cr_5cr bigint DEFAULT 0 NOT NULL,
    value_5cr_10cr bigint DEFAULT 0 NOT NULL,
    value_10cr_50cr bigint DEFAULT 0 NOT NULL,
    value_50cr_plus bigint DEFAULT 0 NOT NULL,
    contracts_bid_number_null bigint DEFAULT 0 NOT NULL,
    unique_sellers bigint DEFAULT 0 NOT NULL,
    unique_buyers bigint DEFAULT 0 NOT NULL,
    new_contracts bigint DEFAULT 0 NOT NULL,
    new_sellers bigint DEFAULT 0 NOT NULL,
    new_buyers bigint DEFAULT 0 NOT NULL,
    new_sellers_with_phone bigint DEFAULT 0 NOT NULL,
    new_buyers_with_email bigint DEFAULT 0 NOT NULL,
    new_contracts_with_bid_number bigint DEFAULT 0 NOT NULL,
    CONSTRAINT single_row_check CHECK ((id = 1))
);


--
-- Name: user_assign_sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_assign_sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(20) NOT NULL,
    password_hash text NOT NULL,
    role character varying(50) DEFAULT 'user'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    permissions jsonb DEFAULT '["dashboard", "contracts", "sellers", "buyers", "whatsapp", "email", "ministries"]'::jsonb
);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: brevo_webhook_log brevo_webhook_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brevo_webhook_log
    ADD CONSTRAINT brevo_webhook_log_pkey PRIMARY KEY (id);


--
-- Name: buying_modes buying_modes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buying_modes
    ADD CONSTRAINT buying_modes_pkey PRIMARY KEY (id);


--
-- Name: category_stats category_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_stats
    ADD CONSTRAINT category_stats_pkey PRIMARY KEY (category);


--
-- Name: category_summary category_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_summary
    ADD CONSTRAINT category_summary_pkey PRIMARY KEY (category);


--
-- Name: contract_list_data contract_list_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_list_data
    ADD CONSTRAINT contract_list_data_pkey PRIMARY KEY (id);


--
-- Name: contract_lists contract_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_lists
    ADD CONSTRAINT contract_lists_pkey PRIMARY KEY (id);


--
-- Name: contract_ministry contract_ministry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_ministry
    ADD CONSTRAINT contract_ministry_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: new_buyer_details new_buyer_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_buyer_details
    ADD CONSTRAINT new_buyer_details_pkey PRIMARY KEY (id);


--
-- Name: new_contracts new_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_contracts
    ADD CONSTRAINT new_contracts_pkey PRIMARY KEY (id);


--
-- Name: new_seller_details new_seller_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_seller_details
    ADD CONSTRAINT new_seller_details_pkey PRIMARY KEY (id);


--
-- Name: new_seller_information new_seller_information_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_seller_information
    ADD CONSTRAINT new_seller_information_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_types organization_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_types
    ADD CONSTRAINT organization_types_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: seller_category seller_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_category
    ADD CONSTRAINT seller_category_pkey PRIMARY KEY (id);


--
-- Name: seller_category seller_category_seller_id_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_category
    ADD CONSTRAINT seller_category_seller_id_category_key UNIQUE (seller_id, category);


--
-- Name: seller_email_log seller_email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_email_log
    ADD CONSTRAINT seller_email_log_pkey PRIMARY KEY (id);


--
-- Name: seller_whatsapp_bulk_job seller_whatsapp_bulk_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_whatsapp_bulk_job
    ADD CONSTRAINT seller_whatsapp_bulk_job_pkey PRIMARY KEY (id);


--
-- Name: seller_whatsapp_log seller_whatsapp_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_whatsapp_log
    ADD CONSTRAINT seller_whatsapp_log_pkey PRIMARY KEY (id);


--
-- Name: state_wise_contract_list_pages state_wise_contract_list_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_wise_contract_list_pages
    ADD CONSTRAINT state_wise_contract_list_pages_pkey PRIMARY KEY (id);


--
-- Name: state_wise_contract_lists state_wise_contract_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_wise_contract_lists
    ADD CONSTRAINT state_wise_contract_lists_pkey PRIMARY KEY (id);


--
-- Name: states states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_pkey PRIMARY KEY (id);


--
-- Name: total_counts total_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.total_counts
    ADD CONSTRAINT total_counts_pkey PRIMARY KEY (id);


--
-- Name: buying_modes uk_buying_modes_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buying_modes
    ADD CONSTRAINT uk_buying_modes_name UNIQUE (name);


--
-- Name: departments uk_departments_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT uk_departments_name UNIQUE (name);


--
-- Name: organization_types uk_organization_types_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_types
    ADD CONSTRAINT uk_organization_types_name UNIQUE (name);


--
-- Name: organizations uk_organizations_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT uk_organizations_name UNIQUE (name);


--
-- Name: user_assign_sellers uk_user_assign_sellers_seller; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assign_sellers
    ADD CONSTRAINT uk_user_assign_sellers_seller UNIQUE (seller_id);


--
-- Name: user_assign_sellers uk_user_assign_sellers_user_seller; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assign_sellers
    ADD CONSTRAINT uk_user_assign_sellers_user_seller UNIQUE (user_id, seller_id);


--
-- Name: user_assign_sellers user_assign_sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assign_sellers
    ADD CONSTRAINT user_assign_sellers_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_brevo_webhook_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brevo_webhook_log_created_at ON public.brevo_webhook_log USING btree (created_at DESC);


--
-- Name: idx_brevo_webhook_log_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brevo_webhook_log_email ON public.brevo_webhook_log USING btree (email);


--
-- Name: idx_brevo_webhook_log_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brevo_webhook_log_event_type ON public.brevo_webhook_log USING btree (event_type);


--
-- Name: idx_buying_modes_total_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buying_modes_total_contract ON public.buying_modes USING btree (total_contract DESC, name);


--
-- Name: idx_category_stats_cat_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_stats_cat_trgm ON public.category_stats USING btree (category);


--
-- Name: idx_category_stats_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_stats_order ON public.category_stats USING btree (seller_count DESC, category);


--
-- Name: idx_category_summary_seller_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_summary_seller_count ON public.category_summary USING btree (seller_count DESC);


--
-- Name: idx_category_summary_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_summary_trgm ON public.category_summary USING gin (category public.gin_trgm_ops);


--
-- Name: idx_contract_list_data_name_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contract_list_data_name_dates ON public.contract_list_data USING btree (name, from_date, to_date);


--
-- Name: idx_contract_lists_from_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_lists_from_date ON public.contract_lists USING btree (from_date DESC);


--
-- Name: idx_contract_lists_is_scrapped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_lists_is_scrapped ON public.contract_lists USING btree (is_scrapped);


--
-- Name: idx_contract_lists_name_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contract_lists_name_dates ON public.contract_lists USING btree (name, from_date, to_date);


--
-- Name: idx_contract_ministry_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contract_ministry_name ON public.contract_ministry USING btree (name);


--
-- Name: idx_departments_total_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_total_contract ON public.departments USING btree (total_contract DESC, name);


--
-- Name: idx_gin_new_buyer_details_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_buyer_details_company_name ON public.new_buyer_details USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_gin_new_buyer_details_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_buyer_details_email ON public.new_buyer_details USING gin (email public.gin_trgm_ops);


--
-- Name: idx_gin_new_buyer_details_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_buyer_details_gst_number ON public.new_buyer_details USING gin (gst_number public.gin_trgm_ops);


--
-- Name: idx_gin_new_buyer_details_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_buyer_details_phone ON public.new_buyer_details USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_bid_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_bid_number ON public.new_contracts USING gin (bid_number public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_buying_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_buying_mode ON public.new_contracts USING gin (buying_mode public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_contract_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_contract_number ON public.new_contracts USING gin (contract_number public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_department ON public.new_contracts USING gin (department public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_office_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_office_zone ON public.new_contracts USING gin (office_zone public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_order_id ON public.new_contracts USING gin (order_id public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_org_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_org_name ON public.new_contracts USING gin (org_name public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_org_type ON public.new_contracts USING gin (org_type public.gin_trgm_ops);


--
-- Name: idx_gin_new_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_contracts_status ON public.new_contracts USING gin (status_of_the_contract public.gin_trgm_ops);


--
-- Name: idx_gin_new_seller_details_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_seller_details_company_name ON public.new_seller_details USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_gin_new_seller_details_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gin_new_seller_details_seller_id ON public.new_seller_details USING gin (seller_id public.gin_trgm_ops);


--
-- Name: idx_ministry_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ministry_name ON public.contract_ministry USING btree (name);


--
-- Name: idx_ministry_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ministry_name_trgm ON public.contract_ministry USING gin (name public.gin_trgm_ops);


--
-- Name: idx_new_buyer_details_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_company_name ON public.new_buyer_details USING btree (company_name);


--
-- Name: idx_new_buyer_details_contracts_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_contracts_value ON public.new_buyer_details USING btree (total_contracts DESC NULLS LAST, total_value DESC NULLS LAST, company_name);


--
-- Name: idx_new_buyer_details_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_email ON public.new_buyer_details USING btree (email);


--
-- Name: idx_new_buyer_details_email_present; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_email_present ON public.new_buyer_details USING btree (id) WHERE ((email IS NOT NULL) AND (btrim((email)::text) <> ''::text));


--
-- Name: idx_new_buyer_details_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_gst_number ON public.new_buyer_details USING btree (gst_number);


--
-- Name: idx_new_buyer_details_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_phone ON public.new_buyer_details USING btree (phone);


--
-- Name: idx_new_buyer_details_phone_present; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_phone_present ON public.new_buyer_details USING btree (id) WHERE ((phone IS NOT NULL) AND (btrim((phone)::text) <> ''::text));


--
-- Name: idx_new_buyer_details_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_buyer_details_total_value ON public.new_buyer_details USING btree (total_value DESC NULLS LAST);


--
-- Name: idx_new_contracts_bid_present_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_bid_present_date ON public.new_contracts USING btree (contract_date DESC NULLS LAST, created_at DESC) WHERE public.contract_bid_number_present((bid_number)::text);


--
-- Name: idx_new_contracts_bid_present_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_bid_present_value ON public.new_contracts USING btree (total_value DESC NULLS LAST, created_at DESC) WHERE public.contract_bid_number_present((bid_number)::text);


--
-- Name: idx_new_contracts_buyer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_buyer_date ON public.new_contracts USING btree (buyer_id, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_buyer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_buyer_id ON public.new_contracts USING btree (buyer_id);


--
-- Name: idx_new_contracts_buying_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_buying_mode ON public.new_contracts USING btree (buying_mode);


--
-- Name: idx_new_contracts_contract_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_contract_date ON public.new_contracts USING btree (contract_date);


--
-- Name: idx_new_contracts_contract_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_contract_number ON public.new_contracts USING btree (contract_number);


--
-- Name: idx_new_contracts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_created_at ON public.new_contracts USING btree (created_at);


--
-- Name: idx_new_contracts_date_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_date_created ON public.new_contracts USING btree (contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_department ON public.new_contracts USING btree (department);


--
-- Name: idx_new_contracts_ministry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_ministry_date ON public.new_contracts USING btree (ministry_id, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_ministry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_ministry_id ON public.new_contracts USING btree (ministry_id);


--
-- Name: idx_new_contracts_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_order_id ON public.new_contracts USING btree (order_id);


--
-- Name: idx_new_contracts_org_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_org_name ON public.new_contracts USING btree (org_name);


--
-- Name: idx_new_contracts_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_org_type ON public.new_contracts USING btree (org_type);


--
-- Name: idx_new_contracts_seller_bid_present_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_seller_bid_present_date ON public.new_contracts USING btree (seller_id, contract_date DESC NULLS LAST, created_at DESC) WHERE public.contract_bid_number_present((bid_number)::text);


--
-- Name: idx_new_contracts_seller_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_seller_date ON public.new_contracts USING btree (seller_id, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_seller_id ON public.new_contracts USING btree (seller_id);


--
-- Name: idx_new_contracts_state_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_state_date ON public.new_contracts USING btree (state_id, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_state_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_state_id ON public.new_contracts USING btree (state_id);


--
-- Name: idx_new_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_status ON public.new_contracts USING btree (status_of_the_contract);


--
-- Name: idx_new_contracts_status_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_status_date ON public.new_contracts USING btree (status_of_the_contract, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_new_contracts_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_contracts_total_value ON public.new_contracts USING btree (total_value DESC NULLS LAST);


--
-- Name: idx_new_seller_details_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_company_name ON public.new_seller_details USING btree (company_name);


--
-- Name: idx_new_seller_details_contracts_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_contracts_value ON public.new_seller_details USING btree (total_contracts DESC NULLS LAST, total_value DESC NULLS LAST, company_name);


--
-- Name: idx_new_seller_details_email_unsent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_email_unsent ON public.new_seller_details USING btree (id) WHERE (email_sent IS NOT TRUE);


--
-- Name: idx_new_seller_details_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_new_seller_details_seller_id ON public.new_seller_details USING btree (seller_id);


--
-- Name: idx_new_seller_details_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_total_value ON public.new_seller_details USING btree (total_value DESC NULLS LAST);


--
-- Name: idx_new_seller_details_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_type ON public.new_seller_details USING btree (type);


--
-- Name: idx_new_seller_details_type_contracts_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_type_contracts_value ON public.new_seller_details USING btree (type, total_contracts DESC NULLS LAST, total_value DESC NULLS LAST, company_name);


--
-- Name: idx_new_seller_details_type_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_type_total_value ON public.new_seller_details USING btree (type, total_value DESC NULLS LAST, company_name);


--
-- Name: idx_new_seller_details_whatsapp_unsent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_details_whatsapp_unsent ON public.new_seller_details USING btree (id) WHERE (whatsapp_sent IS NOT TRUE);


--
-- Name: idx_new_seller_information_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_email ON public.new_seller_information USING btree (email);


--
-- Name: idx_new_seller_information_email_present; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_email_present ON public.new_seller_information USING btree (seller_id) WHERE ((email IS NOT NULL) AND (btrim((email)::text) <> ''::text));


--
-- Name: idx_new_seller_information_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_gst_number ON public.new_seller_information USING btree (gst_number);


--
-- Name: idx_new_seller_information_gst_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_gst_prefix ON public.new_seller_information USING btree (gst_number text_pattern_ops);


--
-- Name: idx_new_seller_information_phone_present; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_phone_present ON public.new_seller_information USING btree (seller_id) WHERE ((phone IS NOT NULL) AND (btrim((phone)::text) <> ''::text));


--
-- Name: idx_new_seller_information_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_seller_id ON public.new_seller_information USING btree (seller_id);


--
-- Name: idx_new_seller_information_valid_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_seller_information_valid_mobile ON public.new_seller_information USING btree (seller_id) WHERE (public.seller_mobile_digits((phone)::text) IS NOT NULL);


--
-- Name: idx_notifications_user_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id_created_at ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_id_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id_is_read ON public.notifications USING btree (user_id, is_read);


--
-- Name: idx_notifications_webhook_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_notifications_webhook_log_id ON public.notifications USING btree (webhook_log_id) WHERE (webhook_log_id IS NOT NULL);


--
-- Name: idx_organization_types_total_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_types_total_contract ON public.organization_types USING btree (total_contract DESC, name);


--
-- Name: idx_organizations_total_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_total_contract ON public.organizations USING btree (total_contract DESC, name);


--
-- Name: idx_seller_category_cat_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_cat_seller ON public.seller_category USING btree (category, seller_id);


--
-- Name: idx_seller_category_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_category ON public.seller_category USING btree (category);


--
-- Name: idx_seller_category_seller_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_seller_cat ON public.seller_category USING btree (seller_id, category);


--
-- Name: idx_seller_category_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_seller_id ON public.seller_category USING btree (seller_id);


--
-- Name: idx_seller_email_log_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_email_log_email ON public.seller_email_log USING btree (lower(btrim((email)::text)));


--
-- Name: idx_seller_email_log_email_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_email_log_email_sent_at ON public.seller_email_log USING btree (lower(btrim((email)::text)), sent_at DESC);


--
-- Name: idx_seller_email_log_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_email_log_seller_id ON public.seller_email_log USING btree (seller_id);


--
-- Name: idx_seller_email_log_seller_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_email_log_seller_sent_at ON public.seller_email_log USING btree (seller_id, sent_at DESC);


--
-- Name: idx_seller_email_log_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_email_log_sent_at ON public.seller_email_log USING btree (sent_at DESC);


--
-- Name: idx_seller_whatsapp_bulk_job_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_whatsapp_bulk_job_status ON public.seller_whatsapp_bulk_job USING btree (status);


--
-- Name: idx_seller_whatsapp_log_destination_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_whatsapp_log_destination_sent_at ON public.seller_whatsapp_log USING btree (destination, sent_at DESC);


--
-- Name: idx_seller_whatsapp_log_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_whatsapp_log_seller_id ON public.seller_whatsapp_log USING btree (seller_id);


--
-- Name: idx_seller_whatsapp_log_seller_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_whatsapp_log_seller_sent_at ON public.seller_whatsapp_log USING btree (seller_id, sent_at DESC);


--
-- Name: idx_seller_whatsapp_log_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_whatsapp_log_sent_at ON public.seller_whatsapp_log USING btree (sent_at DESC);


--
-- Name: idx_state_wise_contract_list_pages_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_wise_contract_list_pages_dates ON public.state_wise_contract_list_pages USING btree (from_date, to_date);


--
-- Name: idx_state_wise_contract_list_pages_is_scraped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_wise_contract_list_pages_is_scraped ON public.state_wise_contract_list_pages USING btree (is_scraped);


--
-- Name: idx_state_wise_contract_list_pages_list_dates_page; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_state_wise_contract_list_pages_list_dates_page ON public.state_wise_contract_list_pages USING btree (state_wise_contract_list_id, from_date, to_date, page_number);


--
-- Name: idx_state_wise_contract_lists_state_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_state_wise_contract_lists_state_id ON public.state_wise_contract_lists USING btree (state_id);


--
-- Name: idx_states_gst_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_states_gst_code ON public.states USING btree (gst_code);


--
-- Name: idx_states_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_states_name ON public.states USING btree (name);


--
-- Name: idx_user_assign_sellers_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_assign_sellers_seller_id ON public.user_assign_sellers USING btree (seller_id);


--
-- Name: idx_user_assign_sellers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_assign_sellers_user_id ON public.user_assign_sellers USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_users_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_name ON public.users USING btree (name);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: uk_new_buyer_details_identity_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_new_buyer_details_identity_key ON public.new_buyer_details USING btree (identity_key);


--
-- Name: uk_new_contracts_contract_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_new_contracts_contract_number ON public.new_contracts USING btree (contract_number) WHERE ((contract_number IS NOT NULL) AND (btrim(contract_number) <> ''::text));


--
-- Name: uk_new_seller_information_seller_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_new_seller_information_seller_contact ON public.new_seller_information USING btree (seller_id, contact_key);


--
-- Name: new_contracts fk_new_contracts_buyer_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_contracts
    ADD CONSTRAINT fk_new_contracts_buyer_id FOREIGN KEY (buyer_id) REFERENCES public.new_buyer_details(id);


--
-- Name: new_contracts fk_new_contracts_ministry_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_contracts
    ADD CONSTRAINT fk_new_contracts_ministry_id FOREIGN KEY (ministry_id) REFERENCES public.contract_ministry(id);


--
-- Name: new_contracts fk_new_contracts_seller_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_contracts
    ADD CONSTRAINT fk_new_contracts_seller_id FOREIGN KEY (seller_id) REFERENCES public.new_seller_details(id);


--
-- Name: new_seller_information fk_new_seller_information_seller_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_seller_information
    ADD CONSTRAINT fk_new_seller_information_seller_id FOREIGN KEY (seller_id) REFERENCES public.new_seller_details(id);


--
-- Name: notifications fk_notifications_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: new_contracts new_contracts_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_contracts
    ADD CONSTRAINT new_contracts_state_id_fkey FOREIGN KEY (state_id) REFERENCES public.states(id);


--
-- Name: seller_email_log seller_email_log_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_email_log
    ADD CONSTRAINT seller_email_log_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.new_seller_details(id);


--
-- Name: seller_email_log seller_email_log_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_email_log
    ADD CONSTRAINT seller_email_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: seller_whatsapp_bulk_job seller_whatsapp_bulk_job_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_whatsapp_bulk_job
    ADD CONSTRAINT seller_whatsapp_bulk_job_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.users(id);


--
-- Name: seller_whatsapp_log seller_whatsapp_log_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_whatsapp_log
    ADD CONSTRAINT seller_whatsapp_log_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.new_seller_details(id);


--
-- Name: seller_whatsapp_log seller_whatsapp_log_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_whatsapp_log
    ADD CONSTRAINT seller_whatsapp_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: state_wise_contract_list_pages state_wise_contract_list_pages_state_wise_contract_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_wise_contract_list_pages
    ADD CONSTRAINT state_wise_contract_list_pages_state_wise_contract_list_id_fkey FOREIGN KEY (state_wise_contract_list_id) REFERENCES public.state_wise_contract_lists(id);


--
-- Name: state_wise_contract_lists state_wise_contract_lists_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_wise_contract_lists
    ADD CONSTRAINT state_wise_contract_lists_state_id_fkey FOREIGN KEY (state_id) REFERENCES public.states(id);


--
-- Name: user_assign_sellers user_assign_sellers_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assign_sellers
    ADD CONSTRAINT user_assign_sellers_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.new_seller_details(id);


--
-- Name: user_assign_sellers user_assign_sellers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assign_sellers
    ADD CONSTRAINT user_assign_sellers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260803162638'),
    ('20260803184648'),
    ('20260804113000'),
    ('20260804121000'),
    ('20260805151500'),
    ('20260806071900'),
    ('20260806072635'),
    ('20260806091503'),
    ('20260806112405'),
    ('20260806183000'),
    ('20260807111608'),
    ('20260812041052'),
    ('20260812042120'),
    ('20260812044000'),
    ('20260812045000'),
    ('20260814063000'),
    ('20260814064000'),
    ('20260814070000'),
    ('20260814071000'),
    ('20260814104835'),
    ('20260817100437'),
    ('20260818124600'),
    ('20260818124700'),
    ('20260819053804'),
    ('20260819100000'),
    ('20260819110000'),
    ('20260819120000'),
    ('20260819130000'),
    ('20260819150000'),
    ('20260819151000'),
    ('20260819153000'),
    ('20260819160000'),
    ('20260819190000'),
    ('20260819191000'),
    ('20260820093000'),
    ('20260820093001'),
    ('20260820093002'),
    ('20260820093003'),
    ('20260820093004'),
    ('20260820093005'),
    ('20260820093006'),
    ('20260820093007'),
    ('20260820103000'),
    ('20260820104000'),
    ('20260820105000'),
    ('20260820105103'),
    ('20260820110000'),
    ('20260820120000'),
    ('20260820130000'),
    ('20260820140000'),
    ('20260820150000'),
    ('20260820160000'),
    ('20260820170000'),
    ('20260820180000'),
    ('20260820190000'),
    ('20260820200000'),
    ('20260821120000'),
    ('20260824040819'),
    ('20260824053328'),
    ('20260824120000'),
    ('20260829103000'),
    ('20260829170000'),
    ('20260901150000'),
    ('20260901182638'),
    ('20260901193000'),
    ('20260902054438'),
    ('20260902120000');

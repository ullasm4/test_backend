\restrict dbmate

-- Dumped from database version 18.3 (Postgres.app)
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
-- Name: contract_bid_number_missing(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_bid_number_missing(v text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT v IS NULL OR BTRIM(v) = '';
$$;


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
-- Name: sync_seller_analysis(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_seller_analysis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_seller_id VARCHAR(255);
  v_old_seller_id VARCHAR(255);
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    v_old_seller_id := OLD.seller_id;
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    v_seller_id := NEW.seller_id;
  END IF;

  -- Process NEW.seller_id
  IF v_seller_id IS NOT NULL AND TRIM(v_seller_id) <> '' THEN
    -- Update or Insert into seller_total_value
    INSERT INTO seller_total_value (seller_id, total_value, updated_at)
    VALUES (
      v_seller_id,
      (SELECT COALESCE(SUM(total_value), 0) FROM contracts WHERE seller_id = v_seller_id),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (seller_id) DO UPDATE
      SET total_value = EXCLUDED.total_value,
          updated_at = CURRENT_TIMESTAMP;

    -- Extract categories from contracts products JSONB for this seller_id and insert into seller_category
    INSERT INTO seller_category (seller_id, category, updated_at)
    SELECT DISTINCT
      v_seller_id,
      clean_cat,
      CURRENT_TIMESTAMP
    FROM (
      SELECT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\s*(&\s*Quadrant)?\s*:\s*', '', 'i')) AS clean_cat
      FROM contracts c,
           jsonb_array_elements(c.products) AS elem
      WHERE c.seller_id = v_seller_id
        AND jsonb_typeof(c.products) = 'array'
        AND elem->>'category' IS NOT NULL
        AND TRIM(elem->>'category') <> ''
    ) sub
    WHERE clean_cat <> ''
      AND LOWER(clean_cat) NOT IN ('category name & quadrant', 'category name', 'category')
    ON CONFLICT (seller_id, category) DO NOTHING;
  END IF;

  -- Process OLD.seller_id if changed on UPDATE or DELETE
  IF v_old_seller_id IS NOT NULL AND TRIM(v_old_seller_id) <> '' AND (v_seller_id IS NULL OR v_seller_id <> v_old_seller_id) THEN
    INSERT INTO seller_total_value (seller_id, total_value, updated_at)
    VALUES (
      v_old_seller_id,
      (SELECT COALESCE(SUM(total_value), 0) FROM contracts WHERE seller_id = v_old_seller_id),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (seller_id) DO UPDATE
      SET total_value = EXCLUDED.total_value,
          updated_at = CURRENT_TIMESTAMP;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: buyers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    company_name character varying(255),
    phone character varying(255),
    email character varying(255),
    address text,
    gst_number character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_mobile boolean DEFAULT false,
    is_email boolean DEFAULT false
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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ministry_id uuid NOT NULL,
    full_html text,
    contract_number text,
    org_type text,
    org_name text,
    buyer_designation text,
    total_value numeric(18,2),
    bid_number text,
    department text,
    office_zone text,
    status_of_the_contract text,
    order_id text,
    contract_pdf_url text,
    buyer_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    seller_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    financial_application jsonb DEFAULT '{}'::jsonb NOT NULL,
    paying_authority jsonb DEFAULT '{}'::jsonb NOT NULL,
    products jsonb DEFAULT '{}'::jsonb NOT NULL,
    consinee_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    buyer_company character varying(255),
    buyer_email character varying(255),
    buyer_phone character varying(255),
    seller_company character varying(255),
    seller_email character varying(255),
    seller_phone character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    contract_date date,
    seller_id character varying(255)
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
-- Name: seller_total_value; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_total_value (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id character varying(255) NOT NULL,
    total_value numeric(18,2) DEFAULT 0.00,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    seller_id character varying(255),
    company_name character varying(255),
    phone character varying(255),
    email character varying(255),
    address text,
    msme_certificate_number character varying(255),
    gst_number character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_mobile boolean DEFAULT false,
    is_email boolean DEFAULT false
);


--
-- Name: states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.states (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    gst_code character varying(2)
);


--
-- Name: states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.states_id_seq OWNED BY public.states.id;


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
    CONSTRAINT single_row_check CHECK ((id = 1))
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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states ALTER COLUMN id SET DEFAULT nextval('public.states_id_seq'::regclass);


--
-- Name: buyers buyers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_pkey PRIMARY KEY (id);


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
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


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
-- Name: seller_total_value seller_total_value_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_total_value
    ADD CONSTRAINT seller_total_value_pkey PRIMARY KEY (id);


--
-- Name: seller_total_value seller_total_value_seller_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_total_value
    ADD CONSTRAINT seller_total_value_seller_id_key UNIQUE (seller_id);


--
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (id);


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
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_buyers_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_company_name ON public.buyers USING btree (company_name);


--
-- Name: idx_buyers_company_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_company_name_trgm ON public.buyers USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_buyers_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_contract_id ON public.buyers USING btree (contract_id);


--
-- Name: idx_buyers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_created_at ON public.buyers USING btree (created_at DESC);


--
-- Name: idx_buyers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_email ON public.buyers USING btree (email);


--
-- Name: idx_buyers_email_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_email_created ON public.buyers USING btree (created_at DESC) WHERE (is_email = true);


--
-- Name: idx_buyers_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_email_trgm ON public.buyers USING gin (email public.gin_trgm_ops);


--
-- Name: idx_buyers_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_gst_number ON public.buyers USING btree (gst_number);


--
-- Name: idx_buyers_gst_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_gst_number_trgm ON public.buyers USING gin (gst_number public.gin_trgm_ops);


--
-- Name: idx_buyers_is_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_is_email ON public.buyers USING btree (is_email);


--
-- Name: idx_buyers_is_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_is_mobile ON public.buyers USING btree (is_mobile);


--
-- Name: idx_buyers_mobile_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_mobile_created ON public.buyers USING btree (created_at DESC) WHERE (is_mobile = true);


--
-- Name: idx_buyers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_phone ON public.buyers USING btree (phone);


--
-- Name: idx_buyers_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_phone_trgm ON public.buyers USING gin (phone public.gin_trgm_ops);


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
-- Name: idx_contracts_bid_null_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_bid_null_list ON public.contracts USING btree (contract_date DESC NULLS LAST, created_at DESC) WHERE public.contract_bid_number_missing(bid_number);


--
-- Name: idx_contracts_bid_null_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_bid_null_value ON public.contracts USING btree (total_value DESC NULLS LAST, created_at DESC) WHERE public.contract_bid_number_missing(bid_number);


--
-- Name: idx_contracts_bid_num_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_bid_num_trgm ON public.contracts USING gin (bid_number public.gin_trgm_ops);


--
-- Name: idx_contracts_bid_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_bid_number ON public.contracts USING btree (bid_number);


--
-- Name: idx_contracts_buyer_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_buyer_company ON public.contracts USING btree (buyer_company);


--
-- Name: idx_contracts_buyer_company_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_buyer_company_trgm ON public.contracts USING gin (buyer_company public.gin_trgm_ops);


--
-- Name: idx_contracts_buyer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_buyer_email ON public.contracts USING btree (buyer_email);


--
-- Name: idx_contracts_buyer_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_buyer_phone ON public.contracts USING btree (buyer_phone);


--
-- Name: idx_contracts_contract_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contract_date ON public.contracts USING btree (contract_date);


--
-- Name: idx_contracts_contract_num_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contract_num_trgm ON public.contracts USING gin (contract_number public.gin_trgm_ops);


--
-- Name: idx_contracts_contract_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contract_number ON public.contracts USING btree (contract_number);


--
-- Name: idx_contracts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_created_at ON public.contracts USING btree (created_at);


--
-- Name: idx_contracts_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_department ON public.contracts USING btree (department);


--
-- Name: idx_contracts_dept_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_dept_trgm ON public.contracts USING gin (department public.gin_trgm_ops);


--
-- Name: idx_contracts_list_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_list_date ON public.contracts USING btree (contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_contracts_min_status_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_min_status_date ON public.contracts USING btree (ministry_id, status_of_the_contract, contract_date DESC);


--
-- Name: idx_contracts_ministry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_ministry_id ON public.contracts USING btree (ministry_id);


--
-- Name: idx_contracts_ministry_list_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_ministry_list_date ON public.contracts USING btree (ministry_id, contract_date DESC NULLS LAST, created_at DESC);


--
-- Name: idx_contracts_office_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_office_zone ON public.contracts USING btree (office_zone);


--
-- Name: idx_contracts_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_order_id ON public.contracts USING btree (order_id);


--
-- Name: idx_contracts_order_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_order_id_trgm ON public.contracts USING gin (order_id public.gin_trgm_ops);


--
-- Name: idx_contracts_org_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_org_name ON public.contracts USING btree (org_name);


--
-- Name: idx_contracts_org_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_org_name_trgm ON public.contracts USING gin (org_name public.gin_trgm_ops);


--
-- Name: idx_contracts_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_org_type ON public.contracts USING btree (org_type);


--
-- Name: idx_contracts_seller_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_company ON public.contracts USING btree (seller_company);


--
-- Name: idx_contracts_seller_company_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_company_trgm ON public.contracts USING gin (seller_company public.gin_trgm_ops);


--
-- Name: idx_contracts_seller_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_date ON public.contracts USING btree (seller_id, contract_date DESC);


--
-- Name: idx_contracts_seller_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_email ON public.contracts USING btree (seller_email);


--
-- Name: idx_contracts_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_id ON public.contracts USING btree (seller_id);


--
-- Name: idx_contracts_seller_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_id_trgm ON public.contracts USING gin (seller_id public.gin_trgm_ops);


--
-- Name: idx_contracts_seller_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_phone ON public.contracts USING btree (seller_phone);


--
-- Name: idx_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_status ON public.contracts USING btree (status_of_the_contract);


--
-- Name: idx_contracts_status_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_status_trgm ON public.contracts USING gin (status_of_the_contract public.gin_trgm_ops);


--
-- Name: idx_contracts_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_total_value ON public.contracts USING btree (total_value);


--
-- Name: idx_ministry_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ministry_name ON public.contract_ministry USING btree (name);


--
-- Name: idx_ministry_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ministry_name_trgm ON public.contract_ministry USING gin (name public.gin_trgm_ops);


--
-- Name: idx_seller_category_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_category ON public.seller_category USING btree (category);


--
-- Name: idx_seller_category_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_category_seller_id ON public.seller_category USING btree (seller_id);


--
-- Name: idx_seller_total_value_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_total_value_seller_id ON public.seller_total_value USING btree (seller_id);


--
-- Name: idx_seller_total_value_total_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_total_value_total_value ON public.seller_total_value USING btree (total_value DESC);


--
-- Name: idx_sellers_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_company_name ON public.sellers USING btree (company_name);


--
-- Name: idx_sellers_company_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_company_name_trgm ON public.sellers USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_sellers_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_contract_id ON public.sellers USING btree (contract_id);


--
-- Name: idx_sellers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_created_at ON public.sellers USING btree (created_at DESC);


--
-- Name: idx_sellers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_email ON public.sellers USING btree (email);


--
-- Name: idx_sellers_email_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_email_created ON public.sellers USING btree (created_at DESC) WHERE (is_email = true);


--
-- Name: idx_sellers_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_email_trgm ON public.sellers USING gin (email public.gin_trgm_ops);


--
-- Name: idx_sellers_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_gst_number ON public.sellers USING btree (gst_number);


--
-- Name: idx_sellers_is_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_is_email ON public.sellers USING btree (is_email);


--
-- Name: idx_sellers_is_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_is_mobile ON public.sellers USING btree (is_mobile);


--
-- Name: idx_sellers_mobile_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_mobile_created ON public.sellers USING btree (created_at DESC) WHERE (is_mobile = true);


--
-- Name: idx_sellers_msme_cert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_msme_cert ON public.sellers USING btree (msme_certificate_number);


--
-- Name: idx_sellers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_phone ON public.sellers USING btree (phone);


--
-- Name: idx_sellers_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_phone_trgm ON public.sellers USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_sellers_seller_gst; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_seller_gst ON public.sellers USING btree (seller_id, gst_number);


--
-- Name: idx_sellers_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_seller_id ON public.sellers USING btree (seller_id);


--
-- Name: idx_sellers_seller_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_seller_id_trgm ON public.sellers USING gin (seller_id public.gin_trgm_ops);


--
-- Name: idx_states_gst_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_states_gst_code ON public.states USING btree (gst_code);


--
-- Name: idx_states_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_states_name ON public.states USING btree (name);


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
-- Name: buyers trigger_set_buyers_mobile_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_set_buyers_mobile_email BEFORE INSERT OR UPDATE ON public.buyers FOR EACH ROW EXECUTE FUNCTION public.set_is_mobile_is_email();


--
-- Name: sellers trigger_set_sellers_mobile_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_set_sellers_mobile_email BEFORE INSERT OR UPDATE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.set_is_mobile_is_email();


--
-- Name: contracts trigger_sync_seller_analysis; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sync_seller_analysis AFTER INSERT OR DELETE OR UPDATE OF seller_id, total_value, products ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.sync_seller_analysis();


--
-- Name: sellers trigger_sync_seller_id_to_contracts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sync_seller_id_to_contracts AFTER INSERT OR UPDATE OF seller_id, contract_id ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.sync_seller_id_to_contracts();


--
-- Name: buyers trigger_update_buyers_with_email_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_buyers_with_email_count AFTER INSERT OR DELETE OR UPDATE OF is_email ON public.buyers FOR EACH ROW EXECUTE FUNCTION public.update_buyers_with_email_count();


--
-- Name: contracts trigger_update_contract_value_bucket_counts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_contract_value_bucket_counts AFTER INSERT OR DELETE OR UPDATE OF total_value ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_contract_value_bucket_counts();


--
-- Name: contracts trigger_update_contracts_bid_number_null_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_contracts_bid_number_null_count AFTER INSERT OR DELETE OR UPDATE OF bid_number ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_contracts_bid_number_null_count();


--
-- Name: contracts trigger_update_contracts_period_counts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_contracts_period_counts AFTER INSERT OR DELETE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_contracts_period_counts();


--
-- Name: contracts trigger_update_ministry_total_contract; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_ministry_total_contract AFTER INSERT OR DELETE OR UPDATE OF ministry_id ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_ministry_total_contract();


--
-- Name: sellers trigger_update_sellers_with_phone_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_sellers_with_phone_count AFTER INSERT OR DELETE OR UPDATE OF is_mobile ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.update_sellers_with_phone_count();


--
-- Name: buyers trigger_update_total_buyers_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_total_buyers_count AFTER INSERT OR DELETE ON public.buyers FOR EACH ROW EXECUTE FUNCTION public.update_total_buyers_count();


--
-- Name: contract_ministry trigger_update_total_contracts_from_ministries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_total_contracts_from_ministries AFTER DELETE OR UPDATE OF total_contract ON public.contract_ministry FOR EACH ROW EXECUTE FUNCTION public.update_total_contracts_from_ministries();


--
-- Name: contract_ministry trigger_update_total_ministries_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_total_ministries_count AFTER INSERT OR DELETE ON public.contract_ministry FOR EACH ROW EXECUTE FUNCTION public.update_total_ministries_count();


--
-- Name: sellers trigger_update_total_sellers_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_total_sellers_count AFTER INSERT OR DELETE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.update_total_sellers_count();


--
-- Name: buyers buyers_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_ministry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_ministry_id_fkey FOREIGN KEY (ministry_id) REFERENCES public.contract_ministry(id);


--
-- Name: sellers sellers_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


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
    ('20260814064000');

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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
    contract_date date
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_buyers_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_contract_id ON public.buyers USING btree (contract_id);


--
-- Name: idx_buyers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_email ON public.buyers USING btree (email);


--
-- Name: idx_buyers_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyers_gst_number ON public.buyers USING btree (gst_number);


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
-- Name: idx_contracts_bid_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_bid_number ON public.contracts USING btree (bid_number);


--
-- Name: idx_contracts_buyer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_buyer_email ON public.contracts USING btree (buyer_email);


--
-- Name: idx_contracts_contract_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contract_date ON public.contracts USING btree (contract_date);


--
-- Name: idx_contracts_contract_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contract_number ON public.contracts USING btree (contract_number);


--
-- Name: idx_contracts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_created_at ON public.contracts USING btree (created_at);


--
-- Name: idx_contracts_ministry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_ministry_id ON public.contracts USING btree (ministry_id);


--
-- Name: idx_contracts_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_order_id ON public.contracts USING btree (order_id);


--
-- Name: idx_contracts_seller_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_seller_email ON public.contracts USING btree (seller_email);


--
-- Name: idx_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_status ON public.contracts USING btree (status_of_the_contract);


--
-- Name: idx_sellers_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_contract_id ON public.sellers USING btree (contract_id);


--
-- Name: idx_sellers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_email ON public.sellers USING btree (email);


--
-- Name: idx_sellers_gst_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_gst_number ON public.sellers USING btree (gst_number);


--
-- Name: idx_sellers_seller_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sellers_seller_id ON public.sellers USING btree (seller_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


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
    ('20260804121000');

-- migrate:up

-- Count columns on unique seller / buyer master rows
ALTER TABLE new_seller_details
  ADD COLUMN IF NOT EXISTS total_contracts BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_value NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE new_buyer_details
  ADD COLUMN IF NOT EXISTS total_contracts BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_value NUMERIC(18, 2) NOT NULL DEFAULT 0;

-- Stable identity keys (NULL and '' are the same) so ON CONFLICT upserts work
CREATE OR REPLACE FUNCTION seller_contact_key(p_phone varchar, p_email varchar)
RETURNS text AS $$
  SELECT LOWER(BTRIM(COALESCE(p_phone, ''))) || chr(31)
      || LOWER(BTRIM(COALESCE(p_email, '')));
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE new_buyer_details
  ADD COLUMN IF NOT EXISTS identity_key text
  GENERATED ALWAYS AS (buyer_identity_key(company_name, phone, email)) STORED;

ALTER TABLE new_seller_information
  ADD COLUMN IF NOT EXISTS contact_key text
  GENERATED ALWAYS AS (seller_contact_key(phone, email)) STORED;

ALTER TABLE new_buyer_details
  DROP CONSTRAINT IF EXISTS uk_new_buyer_details_company_phone_email;
ALTER TABLE new_seller_information
  DROP CONSTRAINT IF EXISTS uk_new_seller_information_seller_phone_email;

CREATE UNIQUE INDEX IF NOT EXISTS uk_new_buyer_details_identity_key
  ON new_buyer_details (identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS uk_new_seller_information_seller_contact
  ON new_seller_information (seller_id, contact_key);

-- Keep new_contracts.id aligned with contracts.id for upserts
-- (PK already unique). No extra unique needed.

-- ---------------------------------------------------------------------------
-- Sync one old contract (+ its latest seller/buyer) into the new tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_old_contract_to_new_tables(p_contract_id uuid)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_sync_old_contract_to_new_tables()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM new_contracts WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM sync_old_contract_to_new_tables(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_sync_old_party_to_new_tables()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_contracts_to_new_tables ON contracts;
CREATE TRIGGER trigger_sync_contracts_to_new_tables
AFTER INSERT OR UPDATE OF
  ministry_id, contract_number, org_type, org_name, total_value,
  department, office_zone, status_of_the_contract, order_id,
  contract_pdf_url, financial_application, paying_authority,
  products, consinee_details, contract_date
ON contracts
FOR EACH ROW
EXECUTE FUNCTION trg_sync_old_contract_to_new_tables();

DROP TRIGGER IF EXISTS trigger_delete_new_contract_on_old_delete ON contracts;
CREATE TRIGGER trigger_delete_new_contract_on_old_delete
AFTER DELETE ON contracts
FOR EACH ROW
EXECUTE FUNCTION trg_sync_old_contract_to_new_tables();

DROP TRIGGER IF EXISTS trigger_sync_sellers_to_new_tables ON sellers;
CREATE TRIGGER trigger_sync_sellers_to_new_tables
AFTER INSERT OR UPDATE OF
  contract_id, seller_id, company_name, phone, email, address,
  msme_certificate_number, gst_number
OR DELETE ON sellers
FOR EACH ROW
EXECUTE FUNCTION trg_sync_old_party_to_new_tables();

DROP TRIGGER IF EXISTS trigger_sync_buyers_to_new_tables ON buyers;
CREATE TRIGGER trigger_sync_buyers_to_new_tables
AFTER INSERT OR UPDATE OF
  contract_id, company_name, phone, email, address, gst_number
OR DELETE ON buyers
FOR EACH ROW
EXECUTE FUNCTION trg_sync_old_party_to_new_tables();

-- ---------------------------------------------------------------------------
-- Maintain seller / buyer contract counts from new_contracts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_new_party_count_delta(
  p_seller_id uuid,
  p_buyer_id uuid,
  p_contracts bigint,
  p_value numeric
)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_new_party_counts_from_contracts()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_new_party_counts ON new_contracts;
CREATE TRIGGER trigger_update_new_party_counts
AFTER INSERT OR DELETE OR UPDATE OF seller_id, buyer_id, total_value ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_new_party_counts_from_contracts();

-- migrate:down

DROP TRIGGER IF EXISTS trigger_update_new_party_counts ON new_contracts;
DROP FUNCTION IF EXISTS update_new_party_counts_from_contracts();
DROP FUNCTION IF EXISTS apply_new_party_count_delta(uuid, uuid, bigint, numeric);

DROP TRIGGER IF EXISTS trigger_sync_buyers_to_new_tables ON buyers;
DROP TRIGGER IF EXISTS trigger_sync_sellers_to_new_tables ON sellers;
DROP TRIGGER IF EXISTS trigger_delete_new_contract_on_old_delete ON contracts;
DROP TRIGGER IF EXISTS trigger_sync_contracts_to_new_tables ON contracts;
DROP FUNCTION IF EXISTS trg_sync_old_party_to_new_tables();
DROP FUNCTION IF EXISTS trg_sync_old_contract_to_new_tables();
DROP FUNCTION IF EXISTS sync_old_contract_to_new_tables(uuid);

DROP INDEX IF EXISTS uk_new_seller_information_seller_contact;
DROP INDEX IF EXISTS uk_new_buyer_details_identity_key;

ALTER TABLE new_seller_information DROP COLUMN IF EXISTS contact_key;
ALTER TABLE new_buyer_details DROP COLUMN IF EXISTS identity_key;

DROP FUNCTION IF EXISTS seller_contact_key(varchar, varchar);

ALTER TABLE new_buyer_details
  DROP COLUMN IF EXISTS total_value,
  DROP COLUMN IF EXISTS total_contracts;

ALTER TABLE new_seller_details
  DROP COLUMN IF EXISTS total_value,
  DROP COLUMN IF EXISTS total_contracts;

ALTER TABLE new_buyer_details
  ADD CONSTRAINT uk_new_buyer_details_company_phone_email
  UNIQUE (company_name, phone, email);

ALTER TABLE new_seller_information
  ADD CONSTRAINT uk_new_seller_information_seller_phone_email
  UNIQUE (seller_id, phone, email);

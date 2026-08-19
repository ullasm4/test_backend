-- migrate:up

CREATE INDEX IF NOT EXISTS idx_new_seller_details_total_value
  ON new_seller_details (total_value DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_new_seller_details_company_name
  ON new_seller_details (company_name);

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_total_value
  ON new_buyer_details (total_value DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_company_name
  ON new_buyer_details (company_name);

CREATE INDEX IF NOT EXISTS idx_new_seller_information_gst_prefix
  ON new_seller_information (gst_number text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_new_seller_information_phone_present
  ON new_seller_information (seller_id)
  WHERE phone IS NOT NULL AND BTRIM(phone) <> '';

CREATE INDEX IF NOT EXISTS idx_new_seller_information_email_present
  ON new_seller_information (seller_id)
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_phone_present
  ON new_buyer_details (id)
  WHERE phone IS NOT NULL AND BTRIM(phone) <> '';

CREATE INDEX IF NOT EXISTS idx_new_buyer_details_email_present
  ON new_buyer_details (id)
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_new_contracts_total_value
  ON new_contracts (total_value DESC NULLS LAST);

-- migrate:down

DROP INDEX IF EXISTS idx_new_contracts_total_value;
DROP INDEX IF EXISTS idx_new_buyer_details_email_present;
DROP INDEX IF EXISTS idx_new_buyer_details_phone_present;
DROP INDEX IF EXISTS idx_new_seller_information_email_present;
DROP INDEX IF EXISTS idx_new_seller_information_phone_present;
DROP INDEX IF EXISTS idx_new_seller_information_gst_prefix;
DROP INDEX IF EXISTS idx_new_buyer_details_company_name;
DROP INDEX IF EXISTS idx_new_buyer_details_total_value;
DROP INDEX IF EXISTS idx_new_seller_details_company_name;
DROP INDEX IF EXISTS idx_new_seller_details_total_value;

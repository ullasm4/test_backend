const PRIMARY_SELLER_CONTACT = `
LEFT JOIN LATERAL (
  SELECT si.phone, si.email, si.address, si.gst_number
  FROM new_seller_information si
  WHERE si.seller_id = sd.id
  ORDER BY
    (si.phone IS NOT NULL AND BTRIM(si.phone) <> '') DESC,
    (si.email IS NOT NULL AND BTRIM(si.email) <> '') DESC,
    si.id
  LIMIT 1
) si ON TRUE
`;

const HAS_PHONE_SQL = `EXISTS (
  SELECT 1 FROM new_seller_information x
  WHERE x.seller_id = sd.id
    AND x.phone IS NOT NULL AND BTRIM(x.phone) <> ''
)`;

const HAS_EMAIL_SQL = `EXISTS (
  SELECT 1 FROM new_seller_information x
  WHERE x.seller_id = sd.id
    AND x.email IS NOT NULL AND BTRIM(x.email) <> ''
)`;

const SELLER_LIST_COLUMNS = `
  sd.id,
  sd.seller_id,
  sd.company_name,
  sd.msme_certificate_number,
  COALESCE(sd.total_value, 0) AS total_value,
  COALESCE(sd.total_contracts, 0)::int AS total_contracts,
  sd.email_sent,
  sd.email_sent_at,
  sd.whatsapp_sent,
  sd.whatsapp_sent_at,
  si.phone,
  si.email,
  si.address,
  si.gst_number,
  (si.phone IS NOT NULL AND BTRIM(si.phone) <> '') AS is_mobile,
  (si.email IS NOT NULL AND BTRIM(si.email) <> '') AS is_email,
  uas.user_id AS assigned_user_id,
  u.name AS assigned_user_name
`;

const LATEST_SELLER_CONTRACT = `
LEFT JOIN LATERAL (
  SELECT nc.id AS contract_id, nc.contract_number, nc.status_of_the_contract
  FROM new_contracts nc
  WHERE nc.seller_id = sd.id
  ORDER BY nc.contract_date DESC NULLS LAST, nc.created_at DESC
  LIMIT 1
) lc ON TRUE
`;

const LATEST_BUYER_CONTRACT = `
LEFT JOIN LATERAL (
  SELECT nc.id AS contract_id, nc.contract_number, nc.status_of_the_contract, nc.total_value AS contract_total_value
  FROM new_contracts nc
  WHERE nc.buyer_id = b.id
  ORDER BY nc.contract_date DESC NULLS LAST, nc.created_at DESC
  LIMIT 1
) lc ON TRUE
`;

module.exports = {
  PRIMARY_SELLER_CONTACT,
  HAS_PHONE_SQL,
  HAS_EMAIL_SQL,
  SELLER_LIST_COLUMNS,
  LATEST_SELLER_CONTRACT,
  LATEST_BUYER_CONTRACT,
};

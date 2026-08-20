const { parseGemContractDate } = require('./htmlFields');
const { normalizeBuyingMode } = require('./contractLookups');

function blankToNull(v) {
  const s = String(v ?? '').trim();
  if (!s || /^(?:[-–—.|]+|NA|N\/A)$/i.test(s)) return null;
  return s;
}

function cleanSellerVal(v) {
  return blankToNull(v) || '';
}

function totalValueFromProducts(products) {
  if (!Array.isArray(products) || !products.length) return null;
  let sum = 0;
  let any = false;
  for (const p of products) {
    const n = Number(String(p.unit_price || p.price || '').replace(/,/g, ''));
    if (!Number.isNaN(n) && n > 0) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

function isNewContractComplete(row) {
  if (!row?.contract_pdf_url) return false;
  const hasSeller = Boolean(
    blankToNull(row.gem_seller_id) ||
      blankToNull(row.seller_company) ||
      blankToNull(row.seller_email) ||
      blankToNull(row.seller_gst)
  );
  if (!hasSeller) return false;

  const c = row.consinee_details;
  if (!c || typeof c !== 'object') return false;
  const cName = blankToNull(c.name);
  const cEmail = blankToNull(c.email);
  const cAddr = blankToNull(c.address);
  if (!cEmail && !cName) return false;
  if (cName && /price|model|hsn|description|category/i.test(cName)) return false;
  if (!cAddr && !cEmail) return false;
  return true;
}

async function findNewContractByNumber(client, contractNumber) {
  const { rows } = await client.query(
    `SELECT
       c.id, c.order_id, c.contract_pdf_url, c.consinee_details, c.ministry_id, c.state_id,
       sd.seller_id AS gem_seller_id,
       sd.company_name AS seller_company,
       si.email AS seller_email,
       si.gst_number AS seller_gst
     FROM new_contracts c
     LEFT JOIN new_seller_details sd ON sd.id = c.seller_id
     LEFT JOIN LATERAL (
       SELECT email, gst_number
       FROM new_seller_information x
       WHERE x.seller_id = sd.id
       ORDER BY
         (x.email IS NOT NULL AND BTRIM(x.email) <> '') DESC,
         x.id
       LIMIT 1
     ) si ON TRUE
     WHERE c.contract_number = $1
     LIMIT 1`,
    [contractNumber]
  );
  return rows[0] || null;
}

async function updateNewContractOrderAndPdf(client, contractId, orderId, pdfUrl) {
  if (!contractId) return;
  await client.query(
    `UPDATE new_contracts SET
       order_id = COALESCE($2, order_id),
       contract_pdf_url = COALESCE($3, contract_pdf_url)
     WHERE id = $1`,
    [contractId, orderId || null, pdfUrl || null]
  );
}

async function upsertSeller(client, seller) {
  const gemId = blankToNull(seller.seller_id);
  if (!gemId) {
    throw new Error('Seller GeM ID is required to insert into new_seller_details');
  }

  const { rows } = await client.query(
    `INSERT INTO new_seller_details (seller_id, company_name, msme_certificate_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (seller_id) DO UPDATE
       SET company_name = COALESCE(EXCLUDED.company_name, new_seller_details.company_name),
           msme_certificate_number = COALESCE(
             EXCLUDED.msme_certificate_number,
             new_seller_details.msme_certificate_number
           )
     RETURNING id`,
    [gemId, blankToNull(seller.company_name), blankToNull(seller.msme_certificate_number)]
  );
  const sellerUuid = rows[0].id;

  await client.query(
    `INSERT INTO new_seller_information (seller_id, phone, email, address, gst_number)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (seller_id, contact_key) DO UPDATE
       SET address = COALESCE(EXCLUDED.address, new_seller_information.address),
           gst_number = COALESCE(EXCLUDED.gst_number, new_seller_information.gst_number)`,
    [
      sellerUuid,
      blankToNull(seller.phone),
      blankToNull(seller.email),
      blankToNull(seller.address),
      blankToNull(seller.gst_number),
    ]
  );

  return sellerUuid;
}

async function upsertBuyer(client, buyer) {
  const company = blankToNull(buyer.company_name);
  const phone = blankToNull(buyer.phone);
  const email = blankToNull(buyer.email);
  if (!company && !phone && !email) {
    throw new Error('Buyer company, phone, or email is required to insert into new_buyer_details');
  }

  const { rows } = await client.query(
    `INSERT INTO new_buyer_details (company_name, phone, email, address, gst_number)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (identity_key) DO UPDATE
       SET address = COALESCE(EXCLUDED.address, new_buyer_details.address),
           gst_number = COALESCE(EXCLUDED.gst_number, new_buyer_details.gst_number)
     RETURNING id`,
    [company, phone, email, blankToNull(buyer.address), blankToNull(buyer.gst_number)]
  );
  return rows[0].id;
}

async function saveScrapedContract(client, {
  existingId,
  ministryId,
  stateId,
  block,
  parsed,
  seller,
  buyer,
  orderId,
  pdfUrl,
}) {
  await client.query('BEGIN');
  try {
    const sellerUuid = await upsertSeller(client, seller);
    const buyerUuid = await upsertBuyer(client, buyer);
    const org = parsed.organisation_details || {};
    const products = Array.isArray(parsed.products) && parsed.products.length
      ? parsed.products
      : (block.products_from_html?.length ? block.products_from_html : []);
    const totalValue = totalValueFromProducts(parsed.products) ?? block.total_value ?? null;
    const contractDate = parseGemContractDate(block.contract_date);
    const found = existingId
      ? { id: existingId }
      : await findNewContractByNumber(client, block.contract_number);

    const values = [
      sellerUuid,
      buyerUuid,
      ministryId,
      block.contract_number,
      org.type || block.org_type || null,
      org.organisation_name || block.org_name || null,
      totalValue,
      org.department || block.department || null,
      org.office_zone || block.office_zone || null,
      block.status_of_the_contract || null,
      orderId || null,
      pdfUrl || null,
      JSON.stringify(parsed.financial_application || {}),
      JSON.stringify(parsed.paying_authority || {}),
      JSON.stringify(products),
      JSON.stringify(parsed.consinee_details || {}),
      contractDate,
      block.bid_number || null,
      block.buyer_designation || null,
      block.buying_mode ? normalizeBuyingMode(block.buying_mode) : null,
      stateId || null,
    ];

    let row;
    if (found?.id) {
      const updated = await client.query(
        `UPDATE new_contracts SET
           seller_id = $1,
           buyer_id = $2,
           ministry_id = COALESCE($3, ministry_id),
           contract_number = $4,
           org_type = COALESCE($5, org_type),
           org_name = COALESCE($6, org_name),
           total_value = COALESCE($7::numeric, total_value),
           department = COALESCE($8, department),
           office_zone = COALESCE($9, office_zone),
           status_of_the_contract = COALESCE($10, status_of_the_contract),
           order_id = COALESCE($11, order_id),
           contract_pdf_url = COALESCE($12, contract_pdf_url),
           financial_application = $13::jsonb,
           paying_authority = $14::jsonb,
           products = CASE
             WHEN jsonb_typeof($15::jsonb) = 'array' AND jsonb_array_length($15::jsonb) > 0 THEN $15::jsonb
             ELSE products
           END,
           consinee_details = $16::jsonb,
           contract_date = COALESCE($17::date, contract_date),
           bid_number = COALESCE($18, bid_number),
           buyer_designation = COALESCE($19, buyer_designation),
           buying_mode = COALESCE($20, buying_mode),
           state_id = COALESCE($21, state_id)
         WHERE id = $22
         RETURNING id, order_id, contract_pdf_url, state_id`,
        [...values, found.id]
      );
      row = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO new_contracts (
           seller_id, buyer_id, ministry_id, contract_number, org_type, org_name,
           total_value, department, office_zone, status_of_the_contract,
           order_id, contract_pdf_url, financial_application, paying_authority,
           products, consinee_details, contract_date,
           bid_number, buyer_designation, buying_mode, state_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::date,
           $18,$19,$20,$21
         )
         RETURNING id, order_id, contract_pdf_url, state_id`,
        values
      );
      row = inserted.rows[0];
    }

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = {
  blankToNull,
  cleanSellerVal,
  findNewContractByNumber,
  isNewContractComplete,
  updateNewContractOrderAndPdf,
  saveScrapedContract,
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { enrichContract } = require('@/lib/contractHelpers');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT
       c.id, c.ministry_id, c.contract_number, c.org_type, c.org_name, c.buyer_designation,
       c.total_value, c.bid_number, c.department, c.office_zone, c.status_of_the_contract,
       c.order_id, c.contract_pdf_url, c.buyer_details, c.seller_details,
       c.financial_application, c.paying_authority, c.products, c.consinee_details,
       c.buyer_company, c.buyer_email, c.buyer_phone, c.seller_company, c.seller_email,
       c.seller_phone, c.contract_date, c.seller_id, c.created_at, c.updated_at,
       m.name AS ministry_name
     FROM contracts c
     LEFT JOIN contract_ministry m ON m.id = c.ministry_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Contract not found', 404, ErrorCode.NOT_FOUND);

  const contract = enrichContract(rows[0]);

  const [sellers, buyers] = await Promise.all([
    db.query(
      `SELECT id, contract_id, seller_id, company_name, phone, email, address,
              msme_certificate_number, gst_number, is_mobile, is_email, created_at, updated_at
       FROM sellers WHERE contract_id = $1 ORDER BY created_at`,
      [req.params.id]
    ),
    db.query(
      `SELECT id, contract_id, company_name, phone, email, address, gst_number,
              is_mobile, is_email, created_at, updated_at
       FROM buyers WHERE contract_id = $1 ORDER BY created_at`,
      [req.params.id]
    ),
  ]);

  return res.status(200).json({
    ...contract,
    sellers: sellers.rows,
    buyers: buyers.rows,
  });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { enrichContract } = require('@/lib/contractHelpers');
const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT
       c.id, c.ministry_id, c.contract_number, c.org_type, c.org_name,
       c.total_value, c.department, c.office_zone, c.status_of_the_contract,
       c.order_id, c.contract_pdf_url, c.financial_application, c.paying_authority,
       c.products, c.consinee_details, c.contract_date, c.created_at,
       c.bid_number, c.buyer_designation, c.buying_mode,
       sd.id AS seller_uuid,
       sd.seller_id,
       sd.company_name AS seller_company,
       sd.msme_certificate_number,
       si.phone AS seller_phone,
       si.email AS seller_email,
       si.address AS seller_address,
       si.gst_number AS seller_gst_number,
       bd.id AS buyer_uuid,
       bd.company_name AS buyer_company,
       bd.phone AS buyer_phone,
       bd.email AS buyer_email,
       bd.address AS buyer_address,
       bd.gst_number AS buyer_gst_number,
       m.name AS ministry_name
     FROM new_contracts c
     JOIN new_seller_details sd ON sd.id = c.seller_id
     ${PRIMARY_SELLER_CONTACT}
     JOIN new_buyer_details bd ON bd.id = c.buyer_id
     LEFT JOIN contract_ministry m ON m.id = c.ministry_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Contract not found', 404, ErrorCode.NOT_FOUND);

  const row = rows[0];
  const contract = enrichContract(row);

  if (req.user && req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [row.seller_uuid, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Contract not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const sellers = [
    {
      id: row.seller_uuid,
      seller_id: row.seller_id,
      company_name: row.seller_company,
      phone: row.seller_phone,
      email: row.seller_email,
      address: row.seller_address,
      msme_certificate_number: row.msme_certificate_number,
      gst_number: row.seller_gst_number,
    },
  ];
  const buyers = [
    {
      id: row.buyer_uuid,
      company_name: row.buyer_company,
      phone: row.buyer_phone,
      email: row.buyer_email,
      address: row.buyer_address,
      gst_number: row.buyer_gst_number,
    },
  ];

  return res.status(200).json({
    ...contract,
    buyer_details: {
      name: row.buyer_company,
      contact_no: row.buyer_phone,
      email: row.buyer_email,
      gstin: row.buyer_gst_number,
      gst_number: row.buyer_gst_number,
    },
    seller_details: {
      company_name: row.seller_company,
      seller_id: row.seller_id,
      contact_no: row.seller_phone,
      email: row.seller_email,
      gst_number: row.seller_gst_number,
      gstin: row.seller_gst_number,
      msme_certificate_number: row.msme_certificate_number,
    },
    sellers,
    buyers,
  });
};

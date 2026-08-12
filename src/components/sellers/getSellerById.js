const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address,
            s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email,
            s.created_at, s.updated_at,
            c.contract_number, c.status_of_the_contract, c.total_value
     FROM sellers s
     LEFT JOIN contracts c ON c.id = s.contract_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const seller = rows[0];
  const sellerIdVal = (seller.seller_id || '').trim();
  const gstNumberVal = (seller.gst_number || '').trim();

  const [valRes, countRes] = await Promise.all([
    sellerIdVal
      ? db.query(`SELECT total_value FROM seller_total_value WHERE seller_id = $1`, [sellerIdVal])
      : Promise.resolve({ rows: [] }),
    db.query(
      `WITH ids AS (
         SELECT c.id, c.total_value
         FROM contracts c
         WHERE $2::text <> '' AND c.seller_id = $2
         UNION
         SELECT c.id, c.total_value
         FROM sellers s
         JOIN contracts c ON c.id = s.contract_id
         WHERE s.id = $1::uuid OR ($3::text <> '' AND s.gst_number = $3)
       )
       SELECT COUNT(*)::int AS total_contracts_count,
              COALESCE(SUM(total_value), 0)::numeric AS total_contracts_value
       FROM ids`,
      [seller.id, sellerIdVal, gstNumberVal]
    ),
  ]);

  const storedValue = valRes.rows[0] ? parseFloat(valRes.rows[0].total_value) || 0 : 0;
  const stats = countRes.rows[0] || { total_contracts_count: 0, total_contracts_value: 0 };
  const finalValue = storedValue || parseFloat(stats.total_contracts_value) || 0;

  return res.status(200).json({
    ...seller,
    total_contracts_count: stats.total_contracts_count,
    total_contracts_value: finalValue,
  });
};

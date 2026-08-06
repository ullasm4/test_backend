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
    `SELECT s.*, c.contract_number, c.status_of_the_contract, c.total_value
     FROM sellers s
     LEFT JOIN contracts c ON c.id = s.contract_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const seller = rows[0];
  const sellerIdVal = (seller.seller_id || '').trim();
  const gstNumberVal = (seller.gst_number || '').trim();

  const statsRes = await db.query(
    `SELECT 
       COUNT(DISTINCT c.id)::int AS total_contracts_count,
       COALESCE(SUM(c.total_value), 0)::numeric AS total_contracts_value
     FROM contracts c
     LEFT JOIN sellers s ON s.contract_id = c.id
     WHERE (
       s.id = $1::uuid
       OR ($2::text <> '' AND (s.seller_id = $2 OR c.seller_id = $2))
       OR ($3::text <> '' AND s.gst_number = $3)
     )`,
    [seller.id, sellerIdVal, gstNumberVal]
  );

  const stats = statsRes.rows[0] || { total_contracts_count: 0, total_contracts_value: 0 };

  return res.status(200).json({
    ...seller,
    total_contracts_count: stats.total_contracts_count,
    total_contracts_value: parseFloat(stats.total_contracts_value) || 0,
  });
};

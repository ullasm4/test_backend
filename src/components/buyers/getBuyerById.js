const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { LATEST_BUYER_CONTRACT } = require('@/lib/newTableSql');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT
       b.id, b.company_name, b.phone, b.email, b.address, b.city_id, c.name AS city, b.gst_number,
       COALESCE(b.total_value, 0) AS total_value,
       COALESCE(b.total_contracts, 0)::int AS total_contracts,
       (b.phone IS NOT NULL AND BTRIM(b.phone) <> '') AS is_mobile,
       (b.email IS NOT NULL AND BTRIM(b.email) <> '') AS is_email,
       lc.contract_id, lc.contract_number, lc.status_of_the_contract
     FROM new_buyer_details b
     LEFT JOIN cities c ON c.id = b.city_id
     ${LATEST_BUYER_CONTRACT}
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Buyer not found', 404, ErrorCode.NOT_FOUND);

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM buyer_end_users WHERE buyer_id = $1 AND end_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Buyer not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const buyer = rows[0];
  return res.status(200).json({
    ...buyer,
    total_contracts_count: buyer.total_contracts,
    total_contracts_value: parseFloat(buyer.total_value) || 0,
  });
};

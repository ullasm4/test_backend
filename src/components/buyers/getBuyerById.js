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
    `SELECT b.id, b.contract_id, b.company_name, b.phone, b.email, b.address, b.gst_number,
            b.is_mobile, b.is_email, b.created_at, b.updated_at,
            c.contract_number, c.status_of_the_contract, c.total_value
     FROM buyers b
     LEFT JOIN contracts c ON c.id = b.contract_id
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Buyer not found', 404, ErrorCode.NOT_FOUND);
  return res.status(200).json(rows[0]);
};

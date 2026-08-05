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
  return res.status(200).json(rows[0]);
};

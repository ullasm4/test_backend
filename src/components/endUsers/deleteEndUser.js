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
  await db.query(`DELETE FROM seller_end_users WHERE end_user_id = $1`, [req.params.id]);
  await db.query(`DELETE FROM buyer_end_users WHERE end_user_id = $1`, [req.params.id]);
  const { rowCount } = await db.query(`DELETE FROM end_users WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  return res.status(200).json({ ok: true });
};

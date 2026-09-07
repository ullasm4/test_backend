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
    `SELECT
       eu.id,
       eu.name,
       eu.email,
       eu.phone,
       eu.is_active,
       eu.created_at,
       eu.updated_at,
       COALESCE(
         (SELECT COUNT(*)::int FROM seller_end_users seu WHERE seu.end_user_id = eu.id),
         0
       ) AS assigned_sellers_count,
       COALESCE(
         (SELECT COUNT(*)::int FROM buyer_end_users beu WHERE beu.end_user_id = eu.id),
         0
       ) AS assigned_buyers_count
     FROM end_users eu
     WHERE eu.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  return res.status(200).json(rows[0]);
};

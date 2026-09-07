const Joi = require('joi');
const bcrypt = require('bcryptjs');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(255).required(),
    phone: Schema.phone().required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().min(4).allow(''),
    is_active: Joi.boolean().default(true),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { name, phone, email, password, is_active } = req.body;
  let password_hash = null;
  if (password) password_hash = await bcrypt.hash(password, constant.bcryptRounds);

  const { rows } = await db.query(
    `UPDATE end_users SET
       name = $2,
       phone = $3,
       email = $4,
       is_active = $5,
       password_hash = COALESCE($6, password_hash),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, name, phone, email, is_active, created_at, updated_at`,
    [req.params.id, name, phone, email, is_active !== false, password_hash]
  );
  if (!rows[0]) throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);

  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM seller_end_users WHERE end_user_id = $1) AS assigned_sellers_count,
       (SELECT COUNT(*)::int FROM buyer_end_users WHERE end_user_id = $1) AS assigned_buyers_count`,
    [req.params.id]
  );

  return res.status(200).json({
    ...rows[0],
    assigned_sellers_count: counts.rows[0]?.assigned_sellers_count || 0,
    assigned_buyers_count: counts.rows[0]?.assigned_buyers_count || 0,
  });
};

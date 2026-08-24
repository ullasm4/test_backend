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
    email: Schema.email(),
    password: Joi.string().min(4).allow(''),
    role: Joi.string().trim().valid('admin', 'user').default('user'),
    is_active: Joi.boolean().default(true),
    permissions: Joi.array().items(Joi.string()).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { name, phone, email, password, role, is_active, permissions } = req.body;
  let password_hash = null;
  if (password) password_hash = await bcrypt.hash(password, constant.bcryptRounds);

  const permissionsJson = Array.isArray(permissions) ? JSON.stringify(permissions) : null;

  const { rows } = await db.query(
    `UPDATE users SET
       name = $2,
       email = $3,
       phone = $4,
       role = $5,
       is_active = $6,
       permissions = COALESCE($7::jsonb, permissions),
       password_hash = COALESCE($8, password_hash),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, name, email, phone, role, is_active, permissions, created_at, updated_at`,
    [req.params.id, name, email || null, phone, role, is_active, permissionsJson, password_hash]
  );
  if (!rows[0]) throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  return res.status(200).json(rows[0]);
};

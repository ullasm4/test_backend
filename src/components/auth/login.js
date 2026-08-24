const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Schema = require('@/config/validationSchema');
const env = require('@/config/env');
const constant = require('@/config/constant');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  body: Joi.object({
    phone: Schema.phone().required(),
    password: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { phone, password } = req.body;

  const { rows } = await db.query(
    `SELECT id, name, email, phone, password_hash, role, is_active, permissions
     FROM users WHERE phone = $1 LIMIT 1`,
    [phone]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw new ServerError('Invalid phone or password', 401, ErrorCode.UNAUTHORIZED);
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new ServerError('Invalid phone or password', 401, ErrorCode.UNAUTHORIZED);
  }

  const token = jwt.sign(
    { id: user.id, phone: user.phone, role: user.role, name: user.name },
    env.JWT_SECRET,
    { expiresIn: constant.jwtExpiresIn }
  );

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      permissions: user.permissions || [],
    },
  });
};

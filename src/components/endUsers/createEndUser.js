const Joi = require('joi');
const bcrypt = require('bcryptjs');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(255).required(),
    phone: Schema.phone().required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().min(4).required(),
    is_active: Joi.boolean().default(true),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { name, phone, email, password, is_active } = req.body;
  const password_hash = await bcrypt.hash(password, constant.bcryptRounds);
  const { rows } = await db.query(
    `INSERT INTO end_users (name, phone, email, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, phone, email, is_active, created_at, updated_at`,
    [name, phone, email, password_hash, is_active !== false]
  );
  return res.status(201).json({
    ...rows[0],
    assigned_sellers_count: 0,
    assigned_buyers_count: 0,
  });
};

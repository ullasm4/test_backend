const Joi = require('joi');
const bcrypt = require('bcryptjs');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(255).required(),
    phone: Schema.phone().required(),
    email: Schema.email(),
    password: Joi.string().min(4).required(),
    role: Joi.string().trim().valid('admin', 'user').default('user'),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { name, phone, email, password, role } = req.body;
  const password_hash = await bcrypt.hash(password, constant.bcryptRounds);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, phone, role, is_active, created_at, updated_at`,
    [name, email || null, phone, password_hash, role]
  );
  return res.status(201).json(rows[0]);
};

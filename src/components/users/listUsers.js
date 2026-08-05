const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || constant.pagination.defaultPage;
  const limit = req.customQuery.limit || constant.pagination.defaultLimit;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';

  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE name ILIKE $1 OR phone ILIKE $1 OR COALESCE(email, '') ILIKE $1`;
  }

  const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM users ${where}`, params);
  params.push(limit, offset);
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const { rows } = await db.query(
    `SELECT id, name, email, phone, role, is_active, created_at, updated_at
     FROM users ${where}
     ORDER BY created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  return res.status(200).json({ data: rows, total: countRes.rows[0].total, page, limit });
};

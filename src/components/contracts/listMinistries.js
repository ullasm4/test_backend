const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit).default(10),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`m.name ILIKE $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  // Use denormalized total_contract (trigger-maintained) — no JOIN to contracts
  const countSql = `SELECT COUNT(*)::int AS total FROM contract_ministry m ${where}`;
  const dataSql = `
    SELECT m.id, m.name, COALESCE(m.total_contract, 0)::int AS contract_count
    FROM contract_ministry m
    ${where}
    ORDER BY COALESCE(m.total_contract, 0) DESC, m.name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, [...params, limit, offset]),
  ]);

  return res.status(200).json({
    data: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

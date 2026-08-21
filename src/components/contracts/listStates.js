const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit).default(50),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 50;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(s.name ILIKE $${params.length} OR s.gst_code ILIKE $${params.length})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total FROM states s ${where}`;
  const dataSql = `
    SELECT
      s.id,
      s.name,
      s.gst_code,
      COALESCE(l.total_contracts, 0)::int AS contract_count
    FROM states s
    LEFT JOIN state_wise_contract_lists l ON l.state_id = s.id
    ${where}
    ORDER BY s.name ASC
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

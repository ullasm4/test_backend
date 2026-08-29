const Joi = require('joi');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit !== undefined ? req.customQuery.limit : 10;
  const offset = (page - 1) * limit;
  const q = (req.customQuery.q || '').trim();

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`cs.category ILIKE $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total FROM category_summary cs ${where}`;
  const dataSql = `
    SELECT cs.category, cs.seller_count, cs.updated_at
    FROM category_summary cs
    ${where}
    ORDER BY cs.seller_count DESC, cs.category ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const dataParams = [...params, limit, offset];

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, dataParams),
  ]);

  const total = countRes.rows[0]?.total || 0;
  const categories = dataRes.rows || [];

  return res.status(200).json({
    categories,
    total,
    page,
    limit,
  });
};

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
    where = `WHERE eu.name ILIKE $1 OR eu.phone ILIKE $1 OR eu.email ILIKE $1`;
  }

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM end_users eu ${where}`, params),
    db.query(
      `SELECT
         eu.id,
         eu.name,
         eu.email,
         eu.phone,
         eu.is_active,
         eu.created_at,
         eu.updated_at,
         COALESCE(s.assigned_sellers_count, 0)::int AS assigned_sellers_count,
         COALESCE(b.assigned_buyers_count, 0)::int AS assigned_buyers_count
       FROM end_users eu
       LEFT JOIN (
         SELECT end_user_id, COUNT(*)::int AS assigned_sellers_count
         FROM seller_end_users
         GROUP BY end_user_id
       ) s ON s.end_user_id = eu.id
       LEFT JOIN (
         SELECT end_user_id, COUNT(*)::int AS assigned_buyers_count
         FROM buyer_end_users
         GROUP BY end_user_id
       ) b ON b.end_user_id = eu.id
       ${where}
       ORDER BY eu.created_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      dataParams
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0].total,
    page,
    limit,
  });
};

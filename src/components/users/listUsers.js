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
    where = `WHERE u.name ILIKE $1 OR u.phone ILIKE $1 OR COALESCE(u.email, '') ILIKE $1`;
  }

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, params),
    db.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.role,
         u.is_active,
         u.permissions,
         u.created_at,
         u.updated_at,
         COALESCE(a.assigned_sellers_count, 0)::int AS assigned_sellers_count
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*)::int AS assigned_sellers_count
         FROM user_assign_sellers
         GROUP BY user_id
       ) a ON a.user_id = u.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      dataParams
    ),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0].total, page, limit });
};

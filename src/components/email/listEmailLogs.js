const Joi = require('joi');
const Schema = require('@/config/validationSchema');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(),
    q: Schema.search(),
    date: Joi.string().trim().pattern(DATE_PATTERN).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const date = req.customQuery.date || '';

  const params = [];
  const clauses = [];

  if (date) {
    params.push(date);
    clauses.push(`l.sent_at >= $${params.length}::date`);
    params.push(date);
    clauses.push(`l.sent_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      l.company_name ILIKE $${params.length} OR
      l.gem_seller_id ILIKE $${params.length} OR
      l.email ILIKE $${params.length} OR
      l.subject ILIKE $${params.length}
    )`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM seller_email_log l ${where}`, params),
    db.query(
      `
      SELECT
        l.id,
        l.seller_id,
        l.gem_seller_id,
        l.company_name,
        l.email,
        l.subject,
        l.source,
        COALESCE(l.response_payload->>'message', '') AS message,
        l.sent_by,
        u.name AS sent_by_name,
        u.email AS sent_by_email,
        l.sent_at
      FROM seller_email_log l
      LEFT JOIN users u ON u.id = l.sent_by
      ${where}
      ORDER BY l.sent_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
      `,
      dataParams
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

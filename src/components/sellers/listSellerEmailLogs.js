const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(50),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to view email logs', 401, ErrorCode.UNAUTHORIZED);
  }

  const sellerId = req.params.id;
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;

  const [countRes, rowsRes] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS total FROM seller_email_log l WHERE l.seller_id = $1', [sellerId]),
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
        u.name AS sent_by_name,
        u.email AS sent_by_email,
        l.sent_at
      FROM seller_email_log l
      LEFT JOIN users u ON u.id = l.sent_by
      WHERE l.seller_id = $1
      ORDER BY l.sent_at DESC
      LIMIT $2 OFFSET $3
      `,
      [sellerId, limit, offset]
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};


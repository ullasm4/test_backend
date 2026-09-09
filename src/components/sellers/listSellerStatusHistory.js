const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { isEndUser } = require('@/middleware/auth');
const { getLeadStatusSchema } = require('@/lib/leadStatusSchema');

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
    throw new ServerError('Login required to view status history', 401, ErrorCode.UNAUTHORIZED);
  }

  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const sellerId = req.params.id;

  const schema = await getLeadStatusSchema(db);
  if (!schema.sellerHistory) {
    return res.status(200).json({ data: [], total: 0, page, limit });
  }

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  } else if (req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      'SELECT COUNT(*)::int AS total FROM seller_status_history h WHERE h.seller_id = $1',
      [sellerId]
    ),
    db.query(
      `
      SELECT
        h.id,
        h.seller_id,
        h.from_status,
        h.to_status,
        h.changed_by,
        u.name AS changed_by_name,
        u.email AS changed_by_email,
        h.changed_at
      FROM seller_status_history h
      LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.seller_id = $1
      ORDER BY h.changed_at DESC
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

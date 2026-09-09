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
  const buyerId = req.params.id;

  const schema = await getLeadStatusSchema(db);
  if (!schema.buyerHistory) {
    return res.status(200).json({ data: [], total: 0, page, limit });
  }

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM buyer_end_users WHERE buyer_id = $1 AND end_user_id = $2`,
      [buyerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Buyer not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  } else if (req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1
       FROM new_contracts c
       JOIN user_assign_sellers uas ON uas.seller_id = c.seller_id
       WHERE c.buyer_id = $1 AND uas.user_id = $2
       LIMIT 1`,
      [buyerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Buyer not accessible to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      'SELECT COUNT(*)::int AS total FROM buyer_status_history h WHERE h.buyer_id = $1',
      [buyerId]
    ),
    db.query(
      `
      SELECT
        h.id,
        h.buyer_id,
        h.from_status,
        h.to_status,
        h.changed_by,
        u.name AS changed_by_name,
        u.email AS changed_by_email,
        h.changed_at
      FROM buyer_status_history h
      LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.buyer_id = $1
      ORDER BY h.changed_at DESC
      LIMIT $2 OFFSET $3
      `,
      [buyerId, limit, offset]
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

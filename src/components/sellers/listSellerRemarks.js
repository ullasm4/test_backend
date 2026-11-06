const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const sellerId = req.params.id;
  const page = req.customQuery?.page || 1;
  const limit = req.customQuery?.limit || 50;
  const offset = (page - 1) * limit;

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      'SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2',
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      'SELECT COUNT(*)::int AS total FROM seller_remarks WHERE seller_id = $1',
      [sellerId]
    ),
    db.query(
      `
      SELECT
        r.id,
        r.seller_id,
        r.remark,
        r.created_by,
        COALESCE(u.name, eu.name, 'User') AS created_by_name,
        COALESCE(u.email, eu.email, '') AS created_by_email,
        r.created_at
      FROM seller_remarks r
      LEFT JOIN users u ON u.id = r.created_by
      LEFT JOIN end_users eu ON eu.id = r.created_by
      WHERE r.seller_id = $1
      ORDER BY r.created_at DESC
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

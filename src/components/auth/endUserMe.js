const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

const END_USER_PERMISSIONS = ['contracts', 'sellers', 'buyers'];

exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  if (req.user?.role !== 'end_user') {
    throw new ServerError('Forbidden', 403, ErrorCode.FORBIDDEN);
  }

  const { rows } = await db.query(
    `SELECT id, name, email, phone, is_active, created_at
     FROM end_users WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0] || !rows[0].is_active) {
    throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json({
    ...rows[0],
    role: 'end_user',
    permissions: END_USER_PERMISSIONS,
  });
};

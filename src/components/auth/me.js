const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT id, name, email, phone, role, is_active, created_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0]) {
    throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  }
  return res.status(200).json(rows[0]);
};

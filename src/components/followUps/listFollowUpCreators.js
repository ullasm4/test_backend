const { isEndUser } = require('@/middleware/auth');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id || isEndUser(req.user)) {
    throw new ServerError('Staff access required', 403, ErrorCode.FORBIDDEN);
  }

  if (req.user.role !== 'admin') {
    return res.status(200).json({
      data: [
        {
          id: req.user.id,
          name: req.user.name || 'You',
        },
      ],
    });
  }

  const { rows } = await db.query(
    `
    SELECT DISTINCT u.id, u.name
    FROM follow_ups f
    JOIN users u ON u.id = f.created_by
    WHERE f.created_by IS NOT NULL
    ORDER BY u.name ASC NULLS LAST
    `
  );

  return res.status(200).json({ data: rows });
};

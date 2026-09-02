const { buildNotificationFilter } = require('@/lib/notificationAccess');

exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  const { where, params } = buildNotificationFilter(req.user, { unreadOnly: true });

  const { rows } = await db.query(
    `
    UPDATE notifications n
    SET is_read = TRUE
    ${where}
    RETURNING n.id
    `,
    params
  );

  return res.status(200).json({
    success: true,
    updated: rows.length,
  });
};

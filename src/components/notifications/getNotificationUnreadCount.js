const { buildNotificationFilter } = require('@/lib/notificationAccess');

exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  const { where, params } = buildNotificationFilter(req.user, { unreadOnly: true });

  const { rows } = await db.query(
    `
    SELECT COUNT(*)::int AS unread_count
    FROM notifications n
    ${where}
    `,
    params
  );

  return res.status(200).json({
    unread_count: rows[0]?.unread_count || 0,
  });
};

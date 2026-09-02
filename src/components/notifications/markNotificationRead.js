const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { buildNotificationAccessConditions } = require('@/lib/notificationAccess');

exports.validationSchema = {
  params: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const notificationId = Number(req.params.id);
  const { conditions, params } = buildNotificationAccessConditions(req.user, { tableAlias: 'n' });
  const idParam = `$${params.length + 1}`;
  const whereConditions = [`n.id = ${idParam}`, ...conditions];
  const queryParams = [...params, notificationId];

  const { rows } = await db.query(
    `
    UPDATE notifications n
    SET is_read = TRUE
    WHERE ${whereConditions.join(' AND ')}
    RETURNING n.id, n.is_read
    `,
    queryParams
  );

  if (!rows[0]) {
    throw new ServerError('Notification not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json({
    success: true,
    id: rows[0].id,
    is_read: rows[0].is_read,
  });
};

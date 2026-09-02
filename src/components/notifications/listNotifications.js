const Joi = require('joi');
const constant = require('@/config/constant');
const Schema = require('@/config/validationSchema');
const { buildNotificationFilter } = require('@/lib/notificationAccess');

const notificationListSelect = `
  SELECT
    n.id,
    n.user_id,
    n.title,
    n.message,
    n.is_read,
    n.seller_id,
    n.message_id,
    n.event_type,
    n.created_at,
    sd.company_name AS seller_company_name
  FROM notifications n
  LEFT JOIN new_seller_details sd ON sd.id = n.seller_id
`;

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    unread_only: Joi.boolean().truthy('true').falsy('false').optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || constant.pagination.defaultPage;
  const limit = req.customQuery.limit || constant.pagination.defaultLimit;
  const offset = (page - 1) * limit;
  const unreadOnly = req.customQuery.unread_only === true;

  const { where, params } = buildNotificationFilter(req.user, { unreadOnly });
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM notifications n ${where}`, params),
    db.query(
      `
      ${notificationListSelect}
      ${where}
      ORDER BY n.created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
      `,
      dataParams
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

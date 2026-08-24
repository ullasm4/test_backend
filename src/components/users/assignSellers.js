const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    min_value: Joi.number().min(0).optional(),
    count: Joi.number().integer().min(1).max(10000).optional(),
    seller_ids: Joi.array().items(Schema.uuid()).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const userId = req.params.id;
  const { min_value: minValue, count, seller_ids: sellerIds } = req.body;

  const userRes = await db.query(
    `SELECT id, name FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows[0]) {
    throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  }

  let assigned = 0;
  let sellerIdsResult = [];

  if (Array.isArray(sellerIds) && sellerIds.length > 0) {
    const insertRes = await db.query(
      `INSERT INTO user_assign_sellers (user_id, seller_id)
       SELECT $1, s_id
       FROM unnest($2::uuid[]) AS s_id
       ON CONFLICT (seller_id) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = CURRENT_TIMESTAMP
       RETURNING seller_id`,
      [userId, sellerIds]
    );
    assigned = insertRes.rowCount || 0;
    sellerIdsResult = insertRes.rows.map((r) => r.seller_id);
  } else {
    const insertRes = await db.query(
      `INSERT INTO user_assign_sellers (user_id, seller_id)
       SELECT $3, sd.id
       FROM new_seller_details sd
       WHERE COALESCE(sd.total_value, 0) > $1
         AND NOT EXISTS (
           SELECT 1
           FROM user_assign_sellers uas
           WHERE uas.seller_id = sd.id
         )
       ORDER BY sd.total_value DESC NULLS LAST, sd.company_name ASC NULLS LAST, sd.id ASC
       LIMIT $2
       ON CONFLICT (seller_id) DO NOTHING
       RETURNING seller_id`,
      [minValue || 0, count || 100, userId]
    );
    assigned = insertRes.rowCount || 0;
    sellerIdsResult = insertRes.rows.map((r) => r.seller_id);
  }

  return res.status(200).json({
    user_id: userId,
    user_name: userRes.rows[0].name,
    assigned,
    seller_ids: sellerIdsResult,
    message:
      assigned === 0
        ? 'No sellers assigned'
        : `Assigned ${assigned} seller(s) to ${userRes.rows[0].name}`,
  });
};

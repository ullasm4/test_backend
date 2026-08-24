const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    seller_ids: Joi.array().items(Joi.string().trim()).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const userId = req.params.id;
  const sellerIds = req.body?.seller_ids;

  const userRes = await db.query(`SELECT id, name FROM users WHERE id = $1`, [userId]);
  if (!userRes.rows[0]) {
    throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  }

  let result;
  if (Array.isArray(sellerIds) && sellerIds.length > 0) {
    result = await db.query(
      `DELETE FROM user_assign_sellers
       WHERE user_id = $1
         AND seller_id IN (
           SELECT sd.id FROM new_seller_details sd
           WHERE sd.id::text = ANY($2::text[]) OR sd.seller_id = ANY($2::text[])
         )
       RETURNING seller_id`,
      [userId, sellerIds]
    );
  } else {
    result = await db.query(
      `DELETE FROM user_assign_sellers WHERE user_id = $1 RETURNING seller_id`,
      [userId]
    );
  }

  const removed = result.rowCount || 0;
  return res.status(200).json({
    user_id: userId,
    removed,
    message: `Unassigned ${removed} seller(s) from ${userRes.rows[0].name}`,
  });
};

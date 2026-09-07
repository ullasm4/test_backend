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
  const endUserId = req.params.id;
  const sellerIds = req.body?.seller_ids;

  const userRes = await db.query(`SELECT id, name FROM end_users WHERE id = $1`, [endUserId]);
  if (!userRes.rows[0]) {
    throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  }

  let result;
  if (Array.isArray(sellerIds) && sellerIds.length > 0) {
    result = await db.query(
      `DELETE FROM seller_end_users
       WHERE end_user_id = $1
         AND seller_id IN (
           SELECT sd.id FROM new_seller_details sd
           WHERE sd.id::text = ANY($2::text[]) OR sd.seller_id = ANY($2::text[])
         )
       RETURNING seller_id`,
      [endUserId, sellerIds]
    );
  } else {
    result = await db.query(
      `DELETE FROM seller_end_users WHERE end_user_id = $1 RETURNING seller_id`,
      [endUserId]
    );
  }

  const removed = result.rowCount || 0;
  return res.status(200).json({
    end_user_id: endUserId,
    removed,
    message: `Unassigned ${removed} seller(s) from ${userRes.rows[0].name}`,
  });
};

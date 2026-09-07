const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    buyer_ids: Joi.array().items(Joi.string().trim()).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const endUserId = req.params.id;
  const buyerIds = req.body?.buyer_ids;

  const userRes = await db.query(`SELECT id, name FROM end_users WHERE id = $1`, [endUserId]);
  if (!userRes.rows[0]) {
    throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  }

  let result;
  if (Array.isArray(buyerIds) && buyerIds.length > 0) {
    result = await db.query(
      `DELETE FROM buyer_end_users
       WHERE end_user_id = $1
         AND buyer_id = ANY($2::uuid[])
       RETURNING buyer_id`,
      [endUserId, buyerIds]
    );
  } else {
    result = await db.query(
      `DELETE FROM buyer_end_users WHERE end_user_id = $1 RETURNING buyer_id`,
      [endUserId]
    );
  }

  const removed = result.rowCount || 0;
  return res.status(200).json({
    end_user_id: endUserId,
    removed,
    message: `Unassigned ${removed} buyer(s) from ${userRes.rows[0].name}`,
  });
};

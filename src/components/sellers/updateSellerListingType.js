const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { LISTING_TYPES } = require('@/config/listingType');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    type: Joi.string().valid(...LISTING_TYPES).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user || !req.user.id) {
    throw new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED);
  }

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const { type } = req.body;

  const { rows } = await db.query(
    `UPDATE new_seller_details
     SET type = $2::public.listing_type
     WHERE id = $1
     RETURNING id, type`,
    [req.params.id, type]
  );

  if (!rows[0]) {
    throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json({
    id: rows[0].id,
    type: rows[0].type,
  });
};

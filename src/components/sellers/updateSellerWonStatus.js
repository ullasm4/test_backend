const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { WON_STATUSES } = require('@/config/wonStatus');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    won_status: Joi.string()
      .valid(...WON_STATUSES)
      .allow(null, '')
      .required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id || isEndUser(req.user)) {
    throw new ServerError('Staff access required', 403, ErrorCode.FORBIDDEN);
  }

  const sellerId = req.params.id;
  const raw = req.body.won_status;
  const nextWonStatus =
    raw === null || raw === undefined || String(raw).trim() === ''
      ? null
      : String(raw).trim();

  if (req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const { rows } = await db.query(
    `UPDATE new_seller_details
     SET won_status = $2
     WHERE id = $1
     RETURNING id, won_status`,
    [sellerId, nextWonStatus]
  );

  if (!rows[0]) {
    throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json({
    id: rows[0].id,
    won_status: rows[0].won_status,
  });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    remark: Joi.string().trim().min(1).max(5000).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const sellerId = req.params.id;
  const { remark } = req.body;

  if (!req.user?.id) {
    throw new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED);
  }

  const sellerCheck = await db.query(
    'SELECT id FROM new_seller_details WHERE id = $1',
    [sellerId]
  );
  if (!sellerCheck.rows[0]) {
    throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
  }

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      'SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2',
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const { rows } = await db.query(
    `
    INSERT INTO seller_remarks (seller_id, remark, created_by)
    VALUES ($1, $2, $3)
    RETURNING id, seller_id, remark, created_by, created_at
    `,
    [sellerId, remark.trim(), req.user.id]
  );

  const newRemark = rows[0];

  const userRes = await db.query(
    'SELECT name, email FROM users WHERE id = $1 UNION SELECT name, email FROM end_users WHERE id = $1 LIMIT 1',
    [req.user.id]
  );
  const creator = userRes.rows[0] || {};

  return res.status(201).json({
    data: {
      ...newRemark,
      created_by_name: creator.name || null,
      created_by_email: creator.email || null,
    },
    message: 'Remark added successfully',
  });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const endUserId = req.params.id;
  const page = req.customQuery.page || constant.pagination.defaultPage;
  const limit = req.customQuery.limit || constant.pagination.defaultLimit;
  const offset = (page - 1) * limit;

  const userRes = await db.query(`SELECT id FROM end_users WHERE id = $1`, [endUserId]);
  if (!userRes.rows[0]) {
    throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total FROM buyer_end_users WHERE end_user_id = $1`,
      [endUserId]
    ),
    db.query(
      `SELECT
         beu.id AS assignment_id,
         beu.created_at AS assigned_at,
         b.id,
         b.company_name,
         b.phone,
         b.email,
         b.gst_number,
         b.total_value,
         b.total_contracts
       FROM buyer_end_users beu
       JOIN new_buyer_details b ON b.id = beu.buyer_id
       WHERE beu.end_user_id = $1
       ORDER BY beu.created_at DESC, b.company_name ASC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [endUserId, limit, offset]
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

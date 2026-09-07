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
      `SELECT COUNT(*)::int AS total FROM seller_end_users WHERE end_user_id = $1`,
      [endUserId]
    ),
    db.query(
      `SELECT
         seu.id AS assignment_id,
         seu.created_at AS assigned_at,
         sd.id,
         sd.seller_id,
         sd.company_name,
         sd.total_value,
         sd.total_contracts
       FROM seller_end_users seu
       JOIN new_seller_details sd ON sd.id = seu.seller_id
       WHERE seu.end_user_id = $1
       ORDER BY seu.created_at DESC, sd.company_name ASC NULLS LAST
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

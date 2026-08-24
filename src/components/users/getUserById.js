const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.phone,
       u.role,
       u.is_active,
       u.permissions,
       u.created_at,
       u.updated_at,
       COALESCE(
         (SELECT COUNT(*)::int FROM user_assign_sellers uas WHERE uas.user_id = u.id),
         0
       ) AS assigned_sellers_count
     FROM users u
     WHERE u.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  return res.status(200).json(rows[0]);
};

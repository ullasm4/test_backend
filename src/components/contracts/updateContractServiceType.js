const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    is_service: Joi.boolean().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user || req.user.role !== 'admin') {
    throw new ServerError('Admin access required', 403, ErrorCode.FORBIDDEN);
  }

  const { is_service: isService } = req.body;

  const { rows } = await db.query(
    `UPDATE new_contracts
     SET is_service = $2
     WHERE id = $1
     RETURNING id, is_service`,
    [req.params.id, isService]
  );

  if (!rows[0]) {
    throw new ServerError('Contract not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json({
    id: rows[0].id,
    is_service: rows[0].is_service === true,
  });
};

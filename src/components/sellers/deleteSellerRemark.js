const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
    remarkId: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { id: sellerId, remarkId } = req.params;

  if (!req.user?.id) {
    throw new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED);
  }

  const existingRes = await db.query(
    'SELECT id, created_by FROM seller_remarks WHERE id = $1 AND seller_id = $2',
    [remarkId, sellerId]
  );

  const existing = existingRes.rows[0];
  if (!existing) {
    throw new ServerError('Remark not found', 404, ErrorCode.NOT_FOUND);
  }

  const isAdmin = req.user.role === 'admin';
  const isOwner = existing.created_by === req.user.id;

  if (!isAdmin && !isOwner) {
    throw new ServerError('You can only delete your own remarks', 403, ErrorCode.FORBIDDEN);
  }

  await db.query('DELETE FROM seller_remarks WHERE id = $1', [remarkId]);

  return res.status(200).json({
    message: 'Remark deleted successfully',
  });
};

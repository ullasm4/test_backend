const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const { isEndUser } = require('@/middleware/auth');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id || isEndUser(req.user)) {
    throw new ServerError('Staff access required', 403, ErrorCode.FORBIDDEN);
  }

  const followUpId = req.params.id;
  const isAdmin = req.user.role === 'admin';

  const existing = await db.query(
    `SELECT id, created_by FROM follow_ups WHERE id = $1 LIMIT 1`,
    [followUpId]
  );
  if (!existing.rows[0]) {
    throw new ServerError('Reminder not found', 404, ErrorCode.NOT_FOUND);
  }

  if (!isAdmin && existing.rows[0].created_by !== req.user.id) {
    throw new ServerError('You can only delete your own reminders', 403, ErrorCode.FORBIDDEN);
  }

  await db.query(`DELETE FROM follow_ups WHERE id = $1`, [followUpId]);

  return res.status(200).json({ id: followUpId, deleted: true });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { LEAD_STATUSES } = require('@/config/leadStatus');
const { isEndUser } = require('@/middleware/auth');
const {
  getLeadStatusSchema,
  invalidateLeadStatusSchemaCache,
} = require('@/lib/leadStatusSchema');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    status: Joi.string()
      .valid(...LEAD_STATUSES)
      .required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id || isEndUser(req.user)) {
    throw new ServerError('Staff access required', 403, ErrorCode.FORBIDDEN);
  }

  const schema = await getLeadStatusSchema(db);
  if (!schema.sellerStatus || !schema.sellerHistory) {
    throw new ServerError(
      'Lead status migration not applied yet. Run dbmate up after dump finishes.',
      503,
      ErrorCode.INTERNAL
    );
  }

  const sellerId = req.params.id;
  const nextStatus = req.body.status;

  if (req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT id, COALESCE(status, 'new') AS status FROM new_seller_details WHERE id = $1 FOR UPDATE`,
      [sellerId]
    );
    if (!currentRes.rows[0]) {
      throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
    }

    const fromStatus = currentRes.rows[0].status;
    if (fromStatus === nextStatus) {
      await client.query('COMMIT');
      return res.status(200).json({ id: sellerId, status: nextStatus, from_status: fromStatus });
    }

    const { rows } = await client.query(
      `UPDATE new_seller_details
       SET status = $2
       WHERE id = $1
       RETURNING id, status`,
      [sellerId, nextStatus]
    );

    await client.query(
      `INSERT INTO seller_status_history (seller_id, from_status, to_status, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [sellerId, fromStatus, nextStatus, req.user.id]
    );

    await client.query('COMMIT');
    invalidateLeadStatusSchemaCache();
    return res.status(200).json({
      id: rows[0].id,
      status: rows[0].status,
      from_status: fromStatus,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
};

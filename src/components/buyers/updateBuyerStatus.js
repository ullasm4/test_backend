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
  if (!schema.buyerStatus || !schema.buyerHistory) {
    throw new ServerError(
      'Lead status migration not applied yet. Run dbmate up after dump finishes.',
      503,
      ErrorCode.INTERNAL
    );
  }

  const buyerId = req.params.id;
  const nextStatus = req.body.status;

  if (req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1
       FROM new_contracts c
       JOIN user_assign_sellers uas ON uas.seller_id = c.seller_id
       WHERE c.buyer_id = $1 AND uas.user_id = $2
       LIMIT 1`,
      [buyerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Buyer not accessible to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT id, COALESCE(status, 'new') AS status FROM new_buyer_details WHERE id = $1 FOR UPDATE`,
      [buyerId]
    );
    if (!currentRes.rows[0]) {
      throw new ServerError('Buyer not found', 404, ErrorCode.NOT_FOUND);
    }

    const fromStatus = currentRes.rows[0].status;
    if (fromStatus === nextStatus) {
      await client.query('COMMIT');
      return res.status(200).json({ id: buyerId, status: nextStatus, from_status: fromStatus });
    }

    const { rows } = await client.query(
      `UPDATE new_buyer_details
       SET status = $2
       WHERE id = $1
       RETURNING id, status`,
      [buyerId, nextStatus]
    );

    await client.query(
      `INSERT INTO buyer_status_history (buyer_id, from_status, to_status, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [buyerId, fromStatus, nextStatus, req.user.id]
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

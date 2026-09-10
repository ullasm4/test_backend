const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const {
  LEAD_STATUSES,
  LEAD_STATUSES_REQUIRING_FOLLOW_UP,
} = require('@/config/leadStatus');
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
    date: Schema.dateOnly().when('status', {
      is: Joi.valid(...LEAD_STATUSES_REQUIRING_FOLLOW_UP),
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ''),
    }),
    remark: Joi.string().trim().max(2000).optional().allow(null, ''),
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
  const followUpDate = req.body.date || null;
  const followUpRemark =
    typeof req.body.remark === 'string' && req.body.remark.trim()
      ? req.body.remark.trim()
      : null;
  const needsFollowUp = LEAD_STATUSES_REQUIRING_FOLLOW_UP.includes(nextStatus);

  if (needsFollowUp && !followUpDate) {
    throw new ServerError('Follow-up date is required for reminder status', 400, ErrorCode.VALIDATION_ERROR);
  }

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
    if (fromStatus === nextStatus && !needsFollowUp) {
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

    if (fromStatus !== nextStatus) {
      await client.query(
        `INSERT INTO buyer_status_history (buyer_id, from_status, to_status, changed_by)
         VALUES ($1, $2, $3, $4)`,
        [buyerId, fromStatus, nextStatus, req.user.id]
      );
    }

    let followUp = null;
    if (needsFollowUp) {
      // Keep a single active reminder for this buyer.
      await client.query(`DELETE FROM follow_ups WHERE buyer_id = $1`, [buyerId]);
      const followUpRes = await client.query(
        `INSERT INTO follow_ups (seller_id, buyer_id, date, remark, created_by)
         VALUES (NULL, $1, $2, $3, $4)
         RETURNING id, buyer_id, date, remark, created_at`,
        [buyerId, followUpDate, followUpRemark, req.user.id]
      );
      followUp = followUpRes.rows[0];
    } else if (fromStatus !== nextStatus) {
      // Leaving reminder (or any other status change) clears reminder rows.
      await client.query(`DELETE FROM follow_ups WHERE buyer_id = $1`, [buyerId]);
    }

    await client.query('COMMIT');
    invalidateLeadStatusSchemaCache();
    return res.status(200).json({
      id: rows[0].id,
      status: rows[0].status,
      from_status: fromStatus,
      follow_up: followUp
        ? {
            id: followUp.id,
            date: followUp.date,
            remark: followUp.remark,
            created_at: followUp.created_at,
          }
        : null,
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

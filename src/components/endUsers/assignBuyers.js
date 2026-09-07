const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { VALUE_RANGE_KEYS } = require('@/lib/contractValueRanges');
const { buildBuyerAssignFilters } = require('@/lib/buildBuyerAssignFilters');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    buyer_ids: Joi.array().items(Joi.string().trim()).optional(),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
    unique_gst: Joi.boolean().optional(),
    sort_value: Joi.string().trim().optional().allow(''),
    value_op: Joi.string().trim().optional().allow(''),
    value_amount: Joi.number().optional().allow('', null),
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
    max_assign: Joi.number().integer().min(1).max(500000).optional(),
    assign_all: Joi.boolean().optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const endUserId = req.params.id;
  const { buyer_ids: buyerIds, max_assign: maxAssign, assign_all: assignAll } = req.body;

  const userRes = await db.query(
    `SELECT id, name FROM end_users WHERE id = $1`,
    [endUserId]
  );
  if (!userRes.rows[0]) {
    throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  }

  let assigned = 0;
  let buyerIdsResult = [];

  if (Array.isArray(buyerIds) && buyerIds.length > 0) {
    const insertRes = await db.query(
      `INSERT INTO buyer_end_users (end_user_id, buyer_id)
       SELECT $1, b.id
       FROM new_buyer_details b
       WHERE b.id::text = ANY($2::text[])
         AND NOT EXISTS (
           SELECT 1 FROM buyer_end_users beu
           WHERE beu.buyer_id = b.id AND beu.end_user_id = $1
         )
       ON CONFLICT (end_user_id, buyer_id) DO NOTHING
       RETURNING buyer_id`,
      [endUserId, buyerIds]
    );
    assigned = insertRes.rowCount || 0;
    buyerIdsResult = insertRes.rows.map((r) => r.buyer_id);
  } else {
    const { params, clauses, orderBy } = await buildBuyerAssignFilters(db, req.body, endUserId);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // params[0] is endUserId from buildBuyerAssignFilters
    const endUserIdx = 1;

    if (assignAll) {
      const insertRes = await db.query(
        `WITH inserted AS (
           INSERT INTO buyer_end_users (end_user_id, buyer_id)
           SELECT $${endUserIdx}, b.id
           FROM new_buyer_details b
           ${where}
           ON CONFLICT (end_user_id, buyer_id) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS assigned FROM inserted`,
        params
      );
      assigned = insertRes.rows[0]?.assigned || 0;
      buyerIdsResult = [];
    } else {
      const limit = maxAssign || 500;
      params.push(limit);
      const limitIdx = params.length;
      const insertRes = await db.query(
        `INSERT INTO buyer_end_users (end_user_id, buyer_id)
         SELECT $${endUserIdx}, b.id
         FROM new_buyer_details b
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx}
         ON CONFLICT (end_user_id, buyer_id) DO NOTHING
         RETURNING buyer_id`,
        params
      );
      assigned = insertRes.rowCount || 0;
      buyerIdsResult = insertRes.rows.map((r) => r.buyer_id);
    }
  }

  return res.status(200).json({
    end_user_id: endUserId,
    end_user_name: userRes.rows[0].name,
    assigned,
    buyer_ids: buyerIdsResult,
    message:
      assigned === 0
        ? 'No buyers assigned'
        : `Assigned ${assigned} buyer(s) to ${userRes.rows[0].name}`,
  });
};

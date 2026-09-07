const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { VALUE_RANGE_KEYS } = require('@/lib/contractValueRanges');
const { LISTING_TYPES } = require('@/config/listingType');
const { buildSellerAssignFilters } = require('@/lib/buildSellerAssignFilters');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    seller_ids: Joi.array().items(Joi.string().trim()).optional(),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    city_id: Schema.uuid().optional().allow('', null),
    type: Joi.string().valid(...LISTING_TYPES).optional().allow(''),
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
  const { seller_ids: sellerIds, max_assign: maxAssign, assign_all: assignAll } = req.body;

  const userRes = await db.query(
    `SELECT id, name FROM end_users WHERE id = $1`,
    [endUserId]
  );
  if (!userRes.rows[0]) {
    throw new ServerError('End user not found', 404, ErrorCode.NOT_FOUND);
  }

  let assigned = 0;
  let sellerIdsResult = [];

  if (Array.isArray(sellerIds) && sellerIds.length > 0) {
    const insertRes = await db.query(
      `INSERT INTO seller_end_users (end_user_id, seller_id)
       SELECT $1, sd.id
       FROM new_seller_details sd
       WHERE (sd.id::text = ANY($2::text[]) OR sd.seller_id = ANY($2::text[]))
         AND NOT EXISTS (
           SELECT 1 FROM seller_end_users seu
           WHERE seu.seller_id = sd.id AND seu.end_user_id = $1
         )
       ON CONFLICT (end_user_id, seller_id) DO NOTHING
       RETURNING seller_id`,
      [endUserId, sellerIds]
    );
    assigned = insertRes.rowCount || 0;
    sellerIdsResult = insertRes.rows.map((r) => r.seller_id);
  } else {
    const { params, clauses, orderBy } = await buildSellerAssignFilters(db, req.body, endUserId);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // params[0] is endUserId from buildSellerAssignFilters
    const endUserIdx = 1;

    if (assignAll) {
      const insertRes = await db.query(
        `WITH inserted AS (
           INSERT INTO seller_end_users (end_user_id, seller_id)
           SELECT $${endUserIdx}, sd.id
           FROM new_seller_details sd
           ${where}
           ON CONFLICT (end_user_id, seller_id) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS assigned FROM inserted`,
        params
      );
      assigned = insertRes.rows[0]?.assigned || 0;
      sellerIdsResult = [];
    } else {
      const limit = maxAssign || 500;
      params.push(limit);
      const limitIdx = params.length;
      const insertRes = await db.query(
        `INSERT INTO seller_end_users (end_user_id, seller_id)
         SELECT $${endUserIdx}, sd.id
         FROM new_seller_details sd
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx}
         ON CONFLICT (end_user_id, seller_id) DO NOTHING
         RETURNING seller_id`,
        params
      );
      assigned = insertRes.rowCount || 0;
      sellerIdsResult = insertRes.rows.map((r) => r.seller_id);
    }
  }

  return res.status(200).json({
    end_user_id: endUserId,
    end_user_name: userRes.rows[0].name,
    assigned,
    seller_ids: sellerIdsResult,
    message:
      assigned === 0
        ? 'No sellers assigned'
        : `Assigned ${assigned} seller(s) to ${userRes.rows[0].name}`,
  });
};

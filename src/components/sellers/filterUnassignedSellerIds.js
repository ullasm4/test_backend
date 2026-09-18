const Joi = require('joi');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  body: Joi.object({
    seller_ids: Joi.array().items(Schema.uuid()).min(1).max(10000).required(),
  }),
};

/**
 * From a list of seller UUIDs, return only those not yet in user_assign_sellers.
 */
exports.controller = async (req, res, _next, db) => {
  const sellerIds = Array.from(
    new Set((req.body.seller_ids || []).map((id) => String(id).trim()).filter(Boolean))
  );

  if (!sellerIds.length) {
    return res.status(200).json({ seller_ids: [], total: 0 });
  }

  const { rows } = await db.query(
    `
    SELECT sd.id
    FROM new_seller_details sd
    WHERE sd.id = ANY($1::uuid[])
      AND NOT EXISTS (
        SELECT 1
        FROM user_assign_sellers uas
        WHERE uas.seller_id = sd.id
      )
    ORDER BY sd.id ASC
    `,
    [sellerIds]
  );

  const unassigned = rows.map((row) => row.id);

  return res.status(200).json({
    seller_ids: unassigned,
    total: unassigned.length,
    requested: sellerIds.length,
    already_assigned: Math.max(sellerIds.length - unassigned.length, 0),
  });
};

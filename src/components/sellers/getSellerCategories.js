const Joi = require('joi');

exports.validationSchema = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const paramId = req.params.id;

  // Resolve seller_id from sellers table if paramId is seller UUID
  const sellerRes = await db.query(
    `SELECT seller_id FROM sellers WHERE id::text = $1 OR seller_id = $1 LIMIT 1`,
    [paramId]
  );
  const sellerId = sellerRes.rows[0]?.seller_id || paramId;

  let categories = [];
  if (sellerId) {
    const catRes = await db.query(
      `SELECT category FROM seller_category WHERE seller_id = $1 ORDER BY category ASC`,
      [sellerId]
    );
    categories = catRes.rows.map((r) => r.category);
  }

  // Fallback to extracting from contracts products if seller_category has no rows for this seller
  if (categories.length === 0 && sellerId) {
    const fallbackRes = await db.query(
      `SELECT DISTINCT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*', '', 'i')) AS category
       FROM contracts c, jsonb_array_elements(c.products) AS elem
       WHERE c.seller_id = $1
         AND jsonb_typeof(c.products) = 'array'
         AND elem->>'category' IS NOT NULL
         AND TRIM(elem->>'category') <> ''
       ORDER BY category ASC`,
      [sellerId]
    );
    categories = fallbackRes.rows
      .map((r) => r.category)
      .filter(
        (c) =>
          c &&
          !['category name & quadrant', 'category name', 'category'].includes(c.toLowerCase())
      );
  }

  return res.status(200).json({
    seller_id: sellerId,
    total_categories: categories.length,
    categories,
  });
};

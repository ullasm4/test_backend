const Joi = require('joi');

exports.validationSchema = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const paramId = req.params.id;

  const sellerRes = await db.query(
    `SELECT id, seller_id
     FROM new_seller_details
     WHERE id::text = $1 OR seller_id = $1
     LIMIT 1`,
    [paramId]
  );

  const seller = sellerRes.rows[0];
  const gemSellerId = seller?.seller_id || paramId;
  const sellerUuid = seller?.id || null;

  let categories = [];
  const catRes = await db.query(
    `SELECT DISTINCT category
     FROM seller_category
     WHERE seller_id = $1::text OR ($2::text IS NOT NULL AND seller_id = $2::text)
     ORDER BY category ASC`,
    [gemSellerId ? String(gemSellerId) : null, sellerUuid ? String(sellerUuid) : null]
  );
  categories = catRes.rows.map((r) => r.category);

  if (categories.length === 0 && sellerUuid) {
    const fallbackRes = await db.query(
      `SELECT DISTINCT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*', '', 'i')) AS category
       FROM new_contracts c, jsonb_array_elements(c.products) AS elem
       WHERE c.seller_id = $1::uuid
         AND jsonb_typeof(c.products) = 'array'
         AND elem->>'category' IS NOT NULL
         AND TRIM(elem->>'category') <> ''
       ORDER BY category ASC`,
      [sellerUuid]
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
    seller_id: gemSellerId,
    total_categories: categories.length,
    categories,
  });
};

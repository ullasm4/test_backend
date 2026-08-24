const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (val) => typeof val === 'string' && UUID_REGEX.test(val);

exports.validationSchema = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const paramId = req.params.id;
  const isParamUuid = isUuid(paramId);

  const sellerRes = await db.query(
    isParamUuid
      ? `SELECT id, seller_id, company_name FROM new_seller_details WHERE id = $1::uuid LIMIT 1`
      : `SELECT id, seller_id, company_name FROM new_seller_details WHERE seller_id = $1 LIMIT 1`,
    [paramId]
  );

  if (!sellerRes.rows[0]) {
    throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
  }

  const seller = sellerRes.rows[0];
  const sellerUuid = seller.id;
  const gemSellerId = seller.seller_id || null;

  // Extract distinct clean category names using indexed seller_id query
  const extractedRes = await db.query(
    `SELECT DISTINCT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*', '', 'i')) AS category
     FROM new_contracts c, jsonb_array_elements(c.products) AS elem
     WHERE c.seller_id = $1::uuid
       AND jsonb_typeof(c.products) = 'array'
       AND elem->>'category' IS NOT NULL
       AND TRIM(elem->>'category') <> ''
     ORDER BY category ASC`,
    [sellerUuid]
  );

  const ignoredHeaders = new Set(['category name & quadrant', 'category name', 'category']);
  const cleanCategories = Array.from(
    new Set(
      extractedRes.rows
        .map((r) => (r.category ? r.category.trim() : ''))
        .filter((c) => c && !ignoredHeaders.has(c.toLowerCase()))
    )
  );

  let insertedCount = 0;

  // Perform bulk insert in a single fast query using unnest
  if (cleanCategories.length > 0) {
    const idsToInsert = Array.from(
      new Set([String(sellerUuid), gemSellerId ? String(gemSellerId) : null].filter(Boolean))
    );

    const insRes = await db.query(
      `INSERT INTO seller_category (seller_id, category, updated_at)
       SELECT s_id, cat, CURRENT_TIMESTAMP
       FROM unnest($1::text[]) AS s_id
       CROSS JOIN unnest($2::text[]) AS cat
       ON CONFLICT (seller_id, category) DO NOTHING`,
      [idsToInsert, cleanCategories]
    );
    insertedCount = insRes.rowCount || 0;
  }

  // Retrieve complete list of categories saved for this seller
  const allCatRes = await db.query(
    `SELECT DISTINCT category
     FROM seller_category
     WHERE seller_id = $1::text OR ($2::text IS NOT NULL AND seller_id = $2::text)
     ORDER BY category ASC`,
    [String(sellerUuid), gemSellerId ? String(gemSellerId) : null]
  );

  const allCategories = allCatRes.rows.map((r) => r.category);

  return res.status(200).json({
    message: 'Categories synced successfully from contract products',
    seller_id: gemSellerId || sellerUuid,
    fetched_count: cleanCategories.length,
    added_count: insertedCount,
    total_categories: allCategories.length,
    categories: allCategories,
  });
};

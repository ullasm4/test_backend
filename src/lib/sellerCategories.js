const IGNORED_CATEGORY_HEADERS = new Set([
  'category name & quadrant',
  'category name',
  'category',
]);

const PRODUCTS_CATEGORY_EXPR = `TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*', '', 'i'))`;

const PRODUCTS_CATEGORY_FILTER = `
  category IS NOT NULL
  AND BTRIM(category) <> ''
  AND LOWER(BTRIM(category)) NOT IN ('category name & quadrant', 'category name', 'category')
`;

async function resolveCategorySellerId(db, { sellerUuid, gemSellerId }) {
  const ids = [...new Set([sellerUuid, gemSellerId].filter(Boolean).map(String))];
  for (const sellerId of ids) {
    const { rows } = await db.query(
      `SELECT 1 FROM seller_category WHERE seller_id = $1 LIMIT 1`,
      [sellerId]
    );
    if (rows[0]) return { type: 'table', sellerId };
  }
  if (sellerUuid) return { type: 'products', sellerUuid };
  return null;
}

async function fetchSellerCategoriesPage(db, { sellerUuid, gemSellerId, limit, offset }) {
  const source = await resolveCategorySellerId(db, { sellerUuid, gemSellerId });
  if (!source) return { total: 0, categories: [] };

  if (source.type === 'table') {
    const [countRes, dataRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total FROM seller_category WHERE seller_id = $1`,
        [source.sellerId]
      ),
      db.query(
        `SELECT category
         FROM seller_category
         WHERE seller_id = $1
         ORDER BY category ASC
         LIMIT $2 OFFSET $3`,
        [source.sellerId, limit, offset]
      ),
    ]);

    return {
      total: countRes.rows[0]?.total || 0,
      categories: dataRes.rows.map((row) => row.category),
    };
  }

  const productsBaseSql = `
    SELECT DISTINCT ${PRODUCTS_CATEGORY_EXPR} AS category
    FROM new_contracts c, jsonb_array_elements(c.products) AS elem
    WHERE c.seller_id = $1::uuid
      AND jsonb_typeof(c.products) = 'array'
      AND elem->>'category' IS NOT NULL
      AND TRIM(elem->>'category') <> ''
  `;

  const [countRes, dataRes] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total
       FROM (${productsBaseSql}) t
       WHERE ${PRODUCTS_CATEGORY_FILTER}`,
      [source.sellerUuid]
    ),
    db.query(
      `SELECT category
       FROM (${productsBaseSql}) t
       WHERE ${PRODUCTS_CATEGORY_FILTER}
       ORDER BY category ASC
       LIMIT $2 OFFSET $3`,
      [source.sellerUuid, limit, offset]
    ),
  ]);

  return {
    total: countRes.rows[0]?.total || 0,
    categories: dataRes.rows.map((row) => row.category).filter(Boolean),
  };
}

async function fetchSellerCategories(db, { sellerUuid, gemSellerId }) {
  const { categories } = await fetchSellerCategoriesPage(db, {
    sellerUuid,
    gemSellerId,
    limit: 100000,
    offset: 0,
  });
  return categories;
}

module.exports = {
  fetchSellerCategories,
  fetchSellerCategoriesPage,
};

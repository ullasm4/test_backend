exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');

    const insertRes = await client.query(`
      WITH cleaned AS (
        SELECT
          sd.id::text AS seller_uuid,
          NULLIF(BTRIM(sd.seller_id), '') AS gem_seller_id,
          TRIM(
            REGEXP_REPLACE(
              elem->>'category',
              '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*',
              '',
              'i'
            )
          ) AS category
        FROM new_contracts c
        JOIN new_seller_details sd ON sd.id = c.seller_id
        CROSS JOIN LATERAL jsonb_array_elements(c.products) AS elem
        WHERE jsonb_typeof(c.products) = 'array'
          AND elem->>'category' IS NOT NULL
          AND BTRIM(elem->>'category') <> ''
      ),
      rows AS (
        SELECT DISTINCT seller_id, category
        FROM (
          SELECT seller_uuid AS seller_id, category FROM cleaned
          UNION ALL
          SELECT gem_seller_id AS seller_id, category
          FROM cleaned
          WHERE gem_seller_id IS NOT NULL
        ) x
        WHERE category <> ''
          AND LOWER(category) NOT IN ('category name & quadrant', 'category name', 'category')
      )
      INSERT INTO seller_category (seller_id, category, updated_at)
      SELECT seller_id, category, CURRENT_TIMESTAMP
      FROM rows
      ON CONFLICT (seller_id, category) DO NOTHING
    `);

    await client.query(`
      INSERT INTO category_summary (category, seller_count, updated_at)
      SELECT category, COUNT(DISTINCT seller_id)::int AS seller_count, CURRENT_TIMESTAMP
      FROM seller_category
      GROUP BY category
      ON CONFLICT (category) DO UPDATE
      SET seller_count = EXCLUDED.seller_count,
          updated_at = CURRENT_TIMESTAMP
    `);

    const { rows } = await client.query(`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(DISTINCT seller_id)::int AS sellers_with_categories
      FROM seller_category
    `);

    const stats = rows[0] || {};
    return res.status(200).json({
      success: true,
      message: 'Seller categories fetched and updated from contract products',
      added: insertRes.rowCount || 0,
      sellers_with_categories: stats.sellers_with_categories || 0,
      total_categories: stats.total_rows || 0,
    });
  } finally {
    client.release();
  }
};

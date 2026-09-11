const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

/** Prevent overlapping full-table category syncs. */
let isSyncing = false;

/** Process sellers in chunks so one mega jsonb expand does not hang the DB / proxy. */
const SELLER_BATCH_SIZE = 250;

async function runSync(db) {
  const client = await db.connect();
  let totalAdded = 0;

  try {
    await client.query('SET statement_timeout = 0');

    let offset = 0;
    for (;;) {
      const { rows: sellers } = await client.query(
        `SELECT id
         FROM new_seller_details
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [SELLER_BATCH_SIZE, offset]
      );

      if (sellers.length === 0) break;

      const sellerIds = sellers.map((s) => s.id);

      const insertRes = await client.query(
        `
        WITH batch AS (
          SELECT
            sd.id,
            NULLIF(BTRIM(sd.seller_id), '') AS gem_seller_id
          FROM new_seller_details sd
          WHERE sd.id = ANY($1::uuid[])
        ),
        cleaned AS (
          SELECT
            b.id::text AS seller_uuid,
            b.gem_seller_id,
            TRIM(
              REGEXP_REPLACE(
                elem->>'category',
                '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*',
                '',
                'i'
              )
            ) AS category
          FROM batch b
          JOIN new_contracts c ON c.seller_id = b.id
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
        `,
        [sellerIds]
      );

      totalAdded += insertRes.rowCount || 0;
      offset += sellers.length;

      console.log(
        `[sync-seller-categories] batch offset=${offset - sellers.length} size=${sellers.length} added=${insertRes.rowCount || 0}`
      );
    }

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
    console.log(
      `[sync-seller-categories] done — added=${totalAdded}, sellers_with_categories=${stats.sellers_with_categories || 0}, total_rows=${stats.total_rows || 0}`
    );
  } catch (err) {
    console.error('[sync-seller-categories] failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  if (isSyncing) {
    throw new ServerError(
      'Seller category sync is already running. Please wait for it to finish.',
      409,
      ErrorCode.CONFLICT
    );
  }

  isSyncing = true;

  // Respond immediately so nginx / proxies do not 504 while the heavy work runs.
  res.status(202).json({
    success: true,
    started: true,
    message:
      'Seller category sync started in the background. Categories will refresh when it finishes (may take several minutes).',
  });

  setImmediate(() => {
    runSync(db)
      .catch(() => {
        // Already logged inside runSync
      })
      .finally(() => {
        isSyncing = false;
      });
  });
};

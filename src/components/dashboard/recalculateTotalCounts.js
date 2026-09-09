const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

/** Prevent overlapping full-table recalculations. */
let isRecalculating = false;

async function runRecalculation(db) {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');
    await client.query('BEGIN');

    // One sequential scan of new_contracts → seller aggregates
    await client.query(`
      CREATE TEMP TABLE tmp_seller_stats ON COMMIT DROP AS
      SELECT seller_id,
             COUNT(*)::int AS cnt,
             COALESCE(SUM(total_value), 0) AS val
      FROM new_contracts
      WHERE seller_id IS NOT NULL
      GROUP BY seller_id
    `);
    await client.query(`CREATE INDEX ON tmp_seller_stats (seller_id)`);

    const sellerUpdateRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_contracts = ss.cnt,
          total_value = ss.val
      FROM tmp_seller_stats ss
      WHERE nsd.id = ss.seller_id
        AND (nsd.total_contracts IS DISTINCT FROM ss.cnt OR nsd.total_value IS DISTINCT FROM ss.val)
    `);

    const sellerZeroRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_contracts = 0, total_value = 0
      WHERE (nsd.total_contracts <> 0 OR nsd.total_value <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM tmp_seller_stats ss WHERE ss.seller_id = nsd.id
        )
    `);

    // One sequential scan of new_contracts → buyer aggregates
    await client.query(`
      CREATE TEMP TABLE tmp_buyer_stats ON COMMIT DROP AS
      SELECT buyer_id,
             COUNT(*)::int AS cnt,
             COALESCE(SUM(total_value), 0) AS val
      FROM new_contracts
      WHERE buyer_id IS NOT NULL
      GROUP BY buyer_id
    `);
    await client.query(`CREATE INDEX ON tmp_buyer_stats (buyer_id)`);

    const buyerUpdateRes = await client.query(`
      UPDATE new_buyer_details nbd
      SET total_contracts = bs.cnt,
          total_value = bs.val
      FROM tmp_buyer_stats bs
      WHERE nbd.id = bs.buyer_id
        AND (nbd.total_contracts IS DISTINCT FROM bs.cnt OR nbd.total_value IS DISTINCT FROM bs.val)
    `);

    const buyerZeroRes = await client.query(`
      UPDATE new_buyer_details nbd
      SET total_contracts = 0, total_value = 0
      WHERE (nbd.total_contracts <> 0 OR nbd.total_value <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM tmp_buyer_stats bs WHERE bs.buyer_id = nbd.id
        )
    `);

    // Single-pass contract aggregates (was ~12 separate COUNT scans)
    await client.query(`
      UPDATE total_counts tc
      SET
        new_contracts = a.new_contracts,
        new_sellers = a.new_sellers,
        new_buyers = a.new_buyers,
        total_ministries = a.total_ministries,
        new_sellers_with_phone = a.new_sellers_with_phone,
        new_buyers_with_email = a.new_buyers_with_email,
        contracts_today = a.contracts_today,
        contracts_week = a.contracts_week,
        value_0_50k = a.value_0_50k,
        value_50k_5l = a.value_50k_5l,
        value_5l_10l = a.value_5l_10l,
        value_10l_50l = a.value_10l_50l,
        value_50l_1cr = a.value_50l_1cr,
        value_1cr_5cr = a.value_1cr_5cr,
        value_5cr_10cr = a.value_5cr_10cr,
        value_10cr_50cr = a.value_10cr_50cr,
        value_50cr_plus = a.value_50cr_plus,
        dashboard_day = CURRENT_DATE,
        updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT
          c.new_contracts,
          c.contracts_today,
          c.contracts_week,
          c.value_0_50k,
          c.value_50k_5l,
          c.value_5l_10l,
          c.value_10l_50l,
          c.value_50l_1cr,
          c.value_1cr_5cr,
          c.value_5cr_10cr,
          c.value_10cr_50cr,
          c.value_50cr_plus,
          (SELECT COUNT(*)::bigint FROM new_seller_details) AS new_sellers,
          (SELECT COUNT(*)::bigint FROM new_buyer_details) AS new_buyers,
          (SELECT COUNT(*)::bigint FROM contract_ministry) AS total_ministries,
          (
            SELECT COUNT(DISTINCT si.seller_id)::bigint
            FROM new_seller_information si
            WHERE si.phone IS NOT NULL AND BTRIM(si.phone) <> ''
          ) AS new_sellers_with_phone,
          (
            SELECT COUNT(*)::bigint FROM new_buyer_details
            WHERE email IS NOT NULL AND BTRIM(email) <> ''
          ) AS new_buyers_with_email
        FROM (
          SELECT
            COUNT(*)::bigint AS new_contracts,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::bigint AS contracts_today,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::bigint AS contracts_week,
            COUNT(*) FILTER (
              WHERE total_value IS NOT NULL AND total_value > 0 AND total_value <= 50000
            )::bigint AS value_0_50k,
            COUNT(*) FILTER (
              WHERE total_value > 50000 AND total_value <= 500000
            )::bigint AS value_50k_5l,
            COUNT(*) FILTER (
              WHERE total_value > 500000 AND total_value <= 1000000
            )::bigint AS value_5l_10l,
            COUNT(*) FILTER (
              WHERE total_value > 1000000 AND total_value <= 5000000
            )::bigint AS value_10l_50l,
            COUNT(*) FILTER (
              WHERE total_value > 5000000 AND total_value <= 10000000
            )::bigint AS value_50l_1cr,
            COUNT(*) FILTER (
              WHERE total_value > 10000000 AND total_value <= 50000000
            )::bigint AS value_1cr_5cr,
            COUNT(*) FILTER (
              WHERE total_value > 50000000 AND total_value <= 100000000
            )::bigint AS value_5cr_10cr,
            COUNT(*) FILTER (
              WHERE total_value > 100000000 AND total_value <= 500000000
            )::bigint AS value_10cr_50cr,
            COUNT(*) FILTER (WHERE total_value > 500000000)::bigint AS value_50cr_plus
          FROM new_contracts
        ) c
      ) a
      WHERE tc.id = 1
    `);

    await client.query('COMMIT');

    const sellersUpdated = (sellerUpdateRes.rowCount || 0) + (sellerZeroRes.rowCount || 0);
    const buyersUpdated = (buyerUpdateRes.rowCount || 0) + (buyerZeroRes.rowCount || 0);
    console.log(
      `[recalculate-total-counts] done — sellers_updated=${sellersUpdated}, buyers_updated=${buyersUpdated}`
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('[recalculate-total-counts] failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  if (isRecalculating) {
    throw new ServerError(
      'Total count recalculation is already running. Please wait for it to finish.',
      409,
      ErrorCode.CONFLICT
    );
  }

  isRecalculating = true;

  // Respond immediately so nginx / proxies do not 504 while the heavy work runs.
  res.status(202).json({
    success: true,
    started: true,
    message:
      'Recalculation started in the background. Dashboard counts will refresh when it finishes (may take several minutes).',
  });

  setImmediate(() => {
    runRecalculation(db)
      .catch(() => {
        // Already logged inside runRecalculation
      })
      .finally(() => {
        isRecalculating = false;
      });
  });
};

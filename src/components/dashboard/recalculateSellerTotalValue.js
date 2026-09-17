const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

/** Prevent overlapping seller total recalculations. */
let isRecalculating = false;

async function runSellerTotalRecalculation(db) {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');
    await client.query('BEGIN');

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

    const updateRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_value = ss.val,
          total_contracts = ss.cnt
      FROM tmp_seller_stats ss
      WHERE nsd.id = ss.seller_id
        AND (nsd.total_value IS DISTINCT FROM ss.val OR nsd.total_contracts IS DISTINCT FROM ss.cnt)
    `);

    const zeroRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_value = 0, total_contracts = 0
      WHERE (nsd.total_value <> 0 OR nsd.total_contracts <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM tmp_seller_stats ss WHERE ss.seller_id = nsd.id
        )
    `);

    await client.query('COMMIT');

    const updated = (updateRes.rowCount || 0) + (zeroRes.rowCount || 0);
    console.log(`[recalculate-seller-total-value] done — updated=${updated}`);
    return updated;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('[recalculate-seller-total-value] failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  if (isRecalculating) {
    throw new ServerError(
      'Seller total value recalculation is already running. Please wait for it to finish.',
      409,
      ErrorCode.CONFLICT
    );
  }

  isRecalculating = true;

  res.status(202).json({
    success: true,
    started: true,
    message:
      'Seller total value recount started in the background. Totals will refresh when it finishes (may take several minutes).',
  });

  setImmediate(() => {
    runSellerTotalRecalculation(db)
      .catch(() => {
        // Already logged inside runSellerTotalRecalculation
      })
      .finally(() => {
        isRecalculating = false;
      });
  });
};

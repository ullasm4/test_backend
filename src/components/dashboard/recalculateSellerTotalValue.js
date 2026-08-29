exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');

    // Single-pass CTE update only modifying rows where value/contracts actually changed
    const updateRes = await client.query(`
      WITH seller_stats AS (
        SELECT seller_id,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(total_value), 0) AS val
        FROM new_contracts
        WHERE seller_id IS NOT NULL
        GROUP BY seller_id
      )
      UPDATE new_seller_details nsd
      SET total_value = ss.val,
          total_contracts = ss.cnt
      FROM seller_stats ss
      WHERE nsd.id = ss.seller_id
        AND (nsd.total_value IS DISTINCT FROM ss.val OR nsd.total_contracts IS DISTINCT FROM ss.cnt)
    `);

    const zeroRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_value = 0, total_contracts = 0
      WHERE (nsd.total_value <> 0 OR nsd.total_contracts <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM new_contracts nc WHERE nc.seller_id = nsd.id
        )
    `);

    const updatedTotal = (updateRes.rowCount || 0) + (zeroRes.rowCount || 0);

    const { rows } = await client.query(`
      SELECT
        COUNT(*)::int AS sellers,
        COUNT(*) FILTER (WHERE total_value > 0)::int AS sellers_with_value,
        COALESCE(SUM(total_value), 0) AS total_value
      FROM new_seller_details
    `);

    const stats = rows[0] || {};
    return res.status(200).json({
      success: true,
      message: 'Seller total values updated from contracts',
      updated: updatedTotal,
      sellers: stats.sellers || 0,
      sellers_with_value: stats.sellers_with_value || 0,
      total_value: Number(stats.total_value) || 0,
    });
  } finally {
    client.release();
  }
};

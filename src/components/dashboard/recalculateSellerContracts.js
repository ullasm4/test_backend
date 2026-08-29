exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');

    // Single-pass update only modifying rows where total_contracts actually changed
    const updateRes = await client.query(`
      WITH contract_counts AS (
        SELECT seller_id, COUNT(*)::int AS cnt
        FROM new_contracts
        WHERE seller_id IS NOT NULL
        GROUP BY seller_id
      )
      UPDATE new_seller_details nsd
      SET total_contracts = cc.cnt
      FROM contract_counts cc
      WHERE nsd.id = cc.seller_id
        AND nsd.total_contracts IS DISTINCT FROM cc.cnt
    `);

    // Reset total_contracts to 0 only for sellers with no contracts whose count is non-zero
    const zeroRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_contracts = 0
      WHERE nsd.total_contracts <> 0
        AND NOT EXISTS (
          SELECT 1 FROM new_contracts nc WHERE nc.seller_id = nsd.id
        )
    `);

    const updatedTotal = (updateRes.rowCount || 0) + (zeroRes.rowCount || 0);

    const { rows } = await client.query(`
      SELECT
        COALESCE(new_sellers, 0)::int AS sellers,
        (SELECT COUNT(*)::int FROM new_seller_details WHERE total_contracts > 0) AS sellers_with_contracts,
        (SELECT COALESCE(SUM(total_contracts), 0)::bigint FROM new_seller_details) AS total_contracts
      FROM total_counts
      WHERE id = 1
    `);

    const stats = rows[0] || {};
    return res.status(200).json({
      success: true,
      message: 'Seller contract counts updated successfully',
      updated: updatedTotal,
      sellers: stats.sellers || 0,
      sellers_with_contracts: stats.sellers_with_contracts || 0,
      total_contracts: Number(stats.total_contracts) || 0,
    });
  } finally {
    client.release();
  }
};

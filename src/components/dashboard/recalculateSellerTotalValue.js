exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');

    const updateRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_value = COALESCE(
        (
          SELECT SUM(nc.total_value)
          FROM new_contracts nc
          WHERE nc.seller_id = nsd.id
        ),
        0
      )
    `);

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
      updated: updateRes.rowCount || 0,
      sellers: stats.sellers || 0,
      sellers_with_value: stats.sellers_with_value || 0,
      total_value: Number(stats.total_value) || 0,
    });
  } finally {
    client.release();
  }
};

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 0');

    // 1. Recalculate seller total_contracts and total_value (only update rows that changed)
    const sellerUpdateRes = await client.query(`
      WITH seller_stats AS (
        SELECT seller_id,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(total_value), 0) AS val
        FROM new_contracts
        WHERE seller_id IS NOT NULL
        GROUP BY seller_id
      )
      UPDATE new_seller_details nsd
      SET total_contracts = ss.cnt,
          total_value = ss.val
      FROM seller_stats ss
      WHERE nsd.id = ss.seller_id
        AND (nsd.total_contracts IS DISTINCT FROM ss.cnt OR nsd.total_value IS DISTINCT FROM ss.val)
    `);

    const sellerZeroRes = await client.query(`
      UPDATE new_seller_details nsd
      SET total_contracts = 0, total_value = 0
      WHERE (nsd.total_contracts <> 0 OR nsd.total_value <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM new_contracts nc WHERE nc.seller_id = nsd.id
        )
    `);

    // 2. Recalculate buyer total_contracts and total_value (only update rows that changed)
    const buyerUpdateRes = await client.query(`
      WITH buyer_stats AS (
        SELECT buyer_id,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(total_value), 0) AS val
        FROM new_contracts
        WHERE buyer_id IS NOT NULL
        GROUP BY buyer_id
      )
      UPDATE new_buyer_details nbd
      SET total_contracts = bs.cnt,
          total_value = bs.val
      FROM buyer_stats bs
      WHERE nbd.id = bs.buyer_id
        AND (nbd.total_contracts IS DISTINCT FROM bs.cnt OR nbd.total_value IS DISTINCT FROM bs.val)
    `);

    const buyerZeroRes = await client.query(`
      UPDATE new_buyer_details nbd
      SET total_contracts = 0, total_value = 0
      WHERE (nbd.total_contracts <> 0 OR nbd.total_value <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM new_contracts nc WHERE nc.buyer_id = nbd.id
        )
    `);

    // 3. Fast aggregate sync into total_counts table
    await client.query(`
      UPDATE total_counts
      SET
        new_contracts = (SELECT COUNT(*)::bigint FROM new_contracts),
        new_sellers = (SELECT COUNT(*)::bigint FROM new_seller_details),
        new_buyers = (SELECT COUNT(*)::bigint FROM new_buyer_details),
        total_ministries = (SELECT COUNT(*)::bigint FROM contract_ministry),
        new_sellers_with_phone = (
          SELECT COUNT(DISTINCT si.seller_id)::bigint
          FROM new_seller_information si
          WHERE si.phone IS NOT NULL AND BTRIM(si.phone) <> ''
        ),
        new_buyers_with_email = (
          SELECT COUNT(*)::bigint FROM new_buyer_details
          WHERE email IS NOT NULL AND BTRIM(email) <> ''
        ),
        contracts_today = (SELECT COUNT(*)::bigint FROM new_contracts WHERE created_at >= CURRENT_DATE),
        contracts_week = (SELECT COUNT(*)::bigint FROM new_contracts WHERE created_at >= NOW() - INTERVAL '7 days'),
        value_0_50k = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value IS NOT NULL AND total_value > 0 AND total_value <= 50000),
        value_50k_5l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 50000 AND total_value <= 500000),
        value_5l_10l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 500000 AND total_value <= 1000000),
        value_10l_50l = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 1000000 AND total_value <= 5000000),
        value_50l_1cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 5000000 AND total_value <= 10000000),
        value_1cr_5cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 10000000 AND total_value <= 50000000),
        value_5cr_10cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 50000000 AND total_value <= 100000000),
        value_10cr_50cr = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 100000000 AND total_value <= 500000000),
        value_50cr_plus = (SELECT COUNT(*)::bigint FROM new_contracts WHERE total_value > 500000000),
        dashboard_day = CURRENT_DATE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `);

    const { rows } = await client.query(`
      SELECT
        COALESCE(new_contracts, 0)::bigint AS contracts,
        COALESCE(new_sellers, 0)::bigint AS sellers,
        COALESCE(new_buyers, 0)::bigint AS buyers
      FROM total_counts
      WHERE id = 1
    `);

    const stats = rows[0] || {};
    return res.status(200).json({
      success: true,
      message: 'Recalculated total counts for buyers, sellers, and contracts',
      sellers_updated: (sellerUpdateRes.rowCount || 0) + (sellerZeroRes.rowCount || 0),
      buyers_updated: (buyerUpdateRes.rowCount || 0) + (buyerZeroRes.rowCount || 0),
      contracts: Number(stats.contracts) || 0,
      sellers: Number(stats.sellers) || 0,
      buyers: Number(stats.buyers) || 0,
    });
  } finally {
    client.release();
  }
};

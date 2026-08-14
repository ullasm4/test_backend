const { CONTRACT_VALUE_RANGES } = require('@/lib/contractValueRanges');

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  // Keep period counters fresh across day boundaries without scanning contracts every request
  await db.query(`
    UPDATE total_counts
    SET
      contracts_today = (SELECT COUNT(*)::bigint FROM contracts WHERE created_at >= CURRENT_DATE),
      contracts_week = (SELECT COUNT(*)::bigint FROM contracts WHERE created_at >= NOW() - INTERVAL '7 days'),
      dashboard_day = CURRENT_DATE,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND (dashboard_day IS DISTINCT FROM CURRENT_DATE)
  `);

  const { rows } = await db.query(`
    SELECT
      COALESCE(total_contracts, 0)::int AS contracts,
      COALESCE(total_sellers, 0)::int AS sellers,
      COALESCE(total_buyers, 0)::int AS buyers,
      COALESCE(total_ministries, 0)::int AS ministries,
      COALESCE(contracts_today, 0)::int AS contracts_today,
      COALESCE(contracts_week, 0)::int AS contracts_week,
      COALESCE(sellers_with_phone, 0)::int AS sellers_with_phone,
      COALESCE(buyers_with_email, 0)::int AS buyers_with_email,
      COALESCE(value_0_50k, 0)::int AS value_0_50k,
      COALESCE(value_50k_5l, 0)::int AS value_50k_5l,
      COALESCE(value_5l_10l, 0)::int AS value_5l_10l,
      COALESCE(value_10l_50l, 0)::int AS value_10l_50l,
      COALESCE(value_50l_1cr, 0)::int AS value_50l_1cr,
      COALESCE(value_1cr_5cr, 0)::int AS value_1cr_5cr,
      COALESCE(value_5cr_10cr, 0)::int AS value_5cr_10cr,
      COALESCE(value_10cr_50cr, 0)::int AS value_10cr_50cr,
      COALESCE(value_50cr_plus, 0)::int AS value_50cr_plus,
      (SELECT COUNT(*)::int FROM users) AS users
    FROM total_counts
    WHERE id = 1
  `);

  const t = rows[0] || {
    contracts: 0,
    sellers: 0,
    buyers: 0,
    ministries: 0,
    contracts_today: 0,
    contracts_week: 0,
    sellers_with_phone: 0,
    buyers_with_email: 0,
    users: 0,
  };

  const value_ranges = CONTRACT_VALUE_RANGES.map((range) => ({
    key: range.key,
    label: range.label,
    count: Number(t[range.column]) || 0,
  }));

  return res.status(200).json({
    totals: {
      contracts: t.contracts,
      sellers: t.sellers,
      buyers: t.buyers,
      users: t.users,
      ministries: t.ministries,
      contracts_today: t.contracts_today,
      contracts_week: t.contracts_week,
    },
    contact: {
      sellers_with_phone: t.sellers_with_phone,
      buyers_with_email: t.buyers_with_email,
    },
    value_ranges,
  });
};

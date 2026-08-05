exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const [totalsRes, contactRes] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM contracts) AS contracts,
        (SELECT COUNT(*)::int FROM sellers) AS sellers,
        (SELECT COUNT(*)::int FROM buyers) AS buyers,
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM contract_ministry) AS ministries,
        (SELECT COUNT(*)::int FROM contracts WHERE created_at::date = CURRENT_DATE) AS contracts_today,
        (SELECT COUNT(*)::int FROM contracts WHERE created_at >= NOW() - INTERVAL '7 days') AS contracts_week
    `),
    db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sellers WHERE COALESCE(TRIM(phone), '') <> '') AS sellers_with_phone,
        (SELECT COUNT(*)::int FROM buyers WHERE COALESCE(TRIM(email), '') <> '') AS buyers_with_email
    `),
  ]);

  const totals = totalsRes.rows[0];
  const contact = contactRes.rows[0];

  return res.status(200).json({
    totals: {
      contracts: totals.contracts,
      sellers: totals.sellers,
      buyers: totals.buyers,
      users: totals.users,
      ministries: totals.ministries,
      contracts_today: totals.contracts_today,
      contracts_week: totals.contracts_week,
    },
    contact: {
      sellers_with_phone: contact.sellers_with_phone,
      buyers_with_email: contact.buyers_with_email,
    },
  });
};

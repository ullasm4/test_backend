const Joi = require('joi');
const Schema = require('@/config/validationSchema');

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

exports.validationSchema = {
  query: Joi.object({
    year: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()),
    party_type: Joi.string().trim().valid('all', 'seller', 'buyer').default('all'),
    role: Joi.string().trim().valid('all', 'admin', 'user').default('all'),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { year, party_type, role, q } = req.customQuery;

  // 1. Get available years in history
  const yearsRes = await db.query(`
    SELECT DISTINCT year FROM (
      SELECT EXTRACT(YEAR FROM changed_at)::int AS year FROM seller_status_history WHERE changed_at IS NOT NULL
      UNION
      SELECT EXTRACT(YEAR FROM changed_at)::int AS year FROM buyer_status_history WHERE changed_at IS NOT NULL
    ) y
    ORDER BY year DESC
  `);
  let availableYears = yearsRes.rows.map((r) => r.year).filter(Boolean);
  if (!availableYears.includes(year)) {
    availableYears.unshift(year);
  }
  availableYears.sort((a, b) => b - a);

  // 2. Fetch monthly stats per user
  const params = [year, party_type];
  let userFilterSql = '';

  if (role !== 'all') {
    params.push(role);
    userFilterSql += ` AND u.role = $${params.length}`;
  }

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    userFilterSql += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }

  const query = `
    WITH history_union AS (
      SELECT
        changed_by,
        seller_id AS party_id,
        'seller' AS party_type,
        changed_at
      FROM seller_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND ($2 = 'all' OR $2 = 'seller')

      UNION ALL

      SELECT
        changed_by,
        buyer_id AS party_id,
        'buyer' AS party_type,
        changed_at
      FROM buyer_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND ($2 = 'all' OR $2 = 'buyer')
    ),
    monthly_agg AS (
      SELECT
        changed_by,
        EXTRACT(MONTH FROM changed_at)::int AS month,
        COUNT(*)::int AS changes_count,
        COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS parties_count
      FROM history_union
      GROUP BY changed_by, EXTRACT(MONTH FROM changed_at)
    ),
    yearly_agg AS (
      SELECT
        changed_by,
        COUNT(*)::int AS total_changes,
        COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS total_parties
      FROM history_union
      GROUP BY changed_by
    )
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      u.email AS user_email,
      u.role AS user_role,
      u.is_active,
      COALESCE(y.total_changes, 0)::int AS total_changes,
      COALESCE(y.total_parties, 0)::int AS total_parties,
      json_agg(
        json_build_object(
          'month', m.month,
          'changes_count', m.changes_count,
          'parties_count', m.parties_count
        )
      ) FILTER (WHERE m.month IS NOT NULL) AS monthly_stats
    FROM users u
    LEFT JOIN yearly_agg y ON y.changed_by = u.id
    LEFT JOIN monthly_agg m ON m.changed_by = u.id
    WHERE u.role <> 'end_user'
      ${userFilterSql}
    GROUP BY u.id, u.name, u.email, u.role, u.is_active, y.total_changes, y.total_parties
    ORDER BY total_changes DESC, u.name ASC
  `;

  // 3. Monthly totals across all users
  const totalsQuery = `
    WITH history_union AS (
      SELECT
        seller_id AS party_id,
        'seller' AS party_type,
        changed_at
      FROM seller_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND ($2 = 'all' OR $2 = 'seller')

      UNION ALL

      SELECT
        buyer_id AS party_id,
        'buyer' AS party_type,
        changed_at
      FROM buyer_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND ($2 = 'all' OR $2 = 'buyer')
    )
    SELECT
      EXTRACT(MONTH FROM changed_at)::int AS month,
      COUNT(*)::int AS changes_count,
      COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS parties_count
    FROM history_union
    GROUP BY EXTRACT(MONTH FROM changed_at)
    ORDER BY month ASC
  `;

  const [usersResult, totalsResult] = await Promise.all([
    db.query(query, params),
    db.query(totalsQuery, [year, party_type]),
  ]);

  // Transform rows to structured format with months 1..12 guaranteed
  const transformedUsers = usersResult.rows.map((row) => {
    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      monthlyMap[m] = { changes_count: 0, parties_count: 0 };
    }

    if (Array.isArray(row.monthly_stats)) {
      row.monthly_stats.forEach((st) => {
        if (st && st.month >= 1 && st.month <= 12) {
          monthlyMap[st.month] = {
            changes_count: Number(st.changes_count) || 0,
            parties_count: Number(st.parties_count) || 0,
          };
        }
      });
    }

    return {
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      user_role: row.user_role,
      is_active: row.is_active,
      total_changes: Number(row.total_changes) || 0,
      total_parties: Number(row.total_parties) || 0,
      monthly: monthlyMap,
    };
  });

  const monthTotals = {};
  let overallChanges = 0;
  for (let m = 1; m <= 12; m++) {
    monthTotals[m] = { changes_count: 0, parties_count: 0 };
  }

  totalsResult.rows.forEach((r) => {
    const m = Number(r.month);
    if (m >= 1 && m <= 12) {
      const changes = Number(r.changes_count) || 0;
      const parties = Number(r.parties_count) || 0;
      monthTotals[m] = { changes_count: changes, parties_count: parties };
      overallChanges += changes;
    }
  });

  // Calculate year unique parties across all users
  const yearPartiesRes = await db.query(`
    WITH history_union AS (
      SELECT 'seller' AS party_type, seller_id AS party_id FROM seller_status_history
      WHERE changed_by IS NOT NULL AND EXTRACT(YEAR FROM changed_at) = $1 AND ($2 = 'all' OR $2 = 'seller')
      UNION ALL
      SELECT 'buyer' AS party_type, buyer_id AS party_id FROM buyer_status_history
      WHERE changed_by IS NOT NULL AND EXTRACT(YEAR FROM changed_at) = $1 AND ($2 = 'all' OR $2 = 'buyer')
    )
    SELECT COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS total_distinct_parties FROM history_union
  `, [year, party_type]);

  const overallParties = Number(yearPartiesRes.rows[0]?.total_distinct_parties) || 0;

  // Active users count (who have at least 1 change this year)
  const activeUsersCount = transformedUsers.filter((u) => u.total_changes > 0).length;
  const topUser = transformedUsers.length > 0 && transformedUsers[0].total_changes > 0
    ? {
        id: transformedUsers[0].user_id,
        name: transformedUsers[0].user_name,
        total_changes: transformedUsers[0].total_changes,
        total_parties: transformedUsers[0].total_parties,
      }
    : null;

  return res.status(200).json({
    year,
    party_type,
    available_years: availableYears,
    months: MONTH_NAMES.map((name, idx) => ({ month: idx + 1, name })),
    summary: {
      total_changes: overallChanges,
      total_parties: overallParties,
      active_users_count: activeUsersCount,
      total_users_count: transformedUsers.length,
      top_user: topUser,
    },
    month_totals: {
      ...monthTotals,
      year_changes: overallChanges,
      year_parties: overallParties,
    },
    users: transformedUsers,
  });
};

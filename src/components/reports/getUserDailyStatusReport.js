const Joi = require('joi');
const Schema = require('@/config/validationSchema');

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

exports.validationSchema = {
  query: Joi.object({
    year: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()),
    month: Joi.number().integer().min(1).max(12).default(() => new Date().getMonth() + 1),
    party_type: Joi.string().trim().valid('all', 'seller', 'buyer').default('all'),
    role: Joi.string().trim().valid('all', 'admin', 'user').default('all'),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { year, month, party_type, role, q } = req.customQuery;

  const daysInMonth = new Date(year, month, 0).getDate();
  const daysList = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    daysList.push({
      day: d,
      weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }),
    });
  }

  // Build params and filters
  const params = [year, month, party_type];
  let userFilterSql = '';

  if (role !== 'all') {
    params.push(role);
    userFilterSql += ` AND u.role = $${params.length}`;
  }

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    userFilterSql += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }

  const userQuery = `
    WITH history_union AS (
      SELECT
        changed_by,
        seller_id AS party_id,
        'seller' AS party_type,
        changed_at
      FROM seller_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND EXTRACT(MONTH FROM changed_at) = $2
        AND ($3 = 'all' OR $3 = 'seller')

      UNION ALL

      SELECT
        changed_by,
        buyer_id AS party_id,
        'buyer' AS party_type,
        changed_at
      FROM buyer_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND EXTRACT(MONTH FROM changed_at) = $2
        AND ($3 = 'all' OR $3 = 'buyer')
    ),
    daily_agg AS (
      SELECT
        changed_by,
        EXTRACT(DAY FROM changed_at)::int AS day,
        COUNT(*)::int AS changes_count,
        COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS parties_count
      FROM history_union
      GROUP BY changed_by, EXTRACT(DAY FROM changed_at)
    ),
    month_user_total AS (
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
      COALESCE(m.total_changes, 0)::int AS total_changes,
      COALESCE(m.total_parties, 0)::int AS total_parties,
      json_agg(
        json_build_object(
          'day', d.day,
          'changes_count', d.changes_count,
          'parties_count', d.parties_count
        )
      ) FILTER (WHERE d.day IS NOT NULL) AS daily_stats
    FROM users u
    LEFT JOIN month_user_total m ON m.changed_by = u.id
    LEFT JOIN daily_agg d ON d.changed_by = u.id
    WHERE u.role <> 'end_user'
      ${userFilterSql}
    GROUP BY u.id, u.name, u.email, u.role, u.is_active, m.total_changes, m.total_parties
    ORDER BY total_changes DESC, u.name ASC
  `;

  // Daily totals across all users
  const totalsQuery = `
    WITH history_union AS (
      SELECT
        seller_id AS party_id,
        'seller' AS party_type,
        changed_at
      FROM seller_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND EXTRACT(MONTH FROM changed_at) = $2
        AND ($3 = 'all' OR $3 = 'seller')

      UNION ALL

      SELECT
        buyer_id AS party_id,
        'buyer' AS party_type,
        changed_at
      FROM buyer_status_history
      WHERE changed_by IS NOT NULL
        AND EXTRACT(YEAR FROM changed_at) = $1
        AND EXTRACT(MONTH FROM changed_at) = $2
        AND ($3 = 'all' OR $3 = 'buyer')
    )
    SELECT
      EXTRACT(DAY FROM changed_at)::int AS day,
      COUNT(*)::int AS changes_count,
      COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS parties_count
    FROM history_union
    GROUP BY EXTRACT(DAY FROM changed_at)
    ORDER BY day ASC
  `;

  // Distinct parties touched in this entire month
  const monthPartiesQuery = `
    WITH history_union AS (
      SELECT 'seller' AS party_type, seller_id AS party_id FROM seller_status_history
      WHERE changed_by IS NOT NULL AND EXTRACT(YEAR FROM changed_at) = $1 AND EXTRACT(MONTH FROM changed_at) = $2 AND ($3 = 'all' OR $3 = 'seller')
      UNION ALL
      SELECT 'buyer' AS party_type, buyer_id AS party_id FROM buyer_status_history
      WHERE changed_by IS NOT NULL AND EXTRACT(YEAR FROM changed_at) = $1 AND EXTRACT(MONTH FROM changed_at) = $2 AND ($3 = 'all' OR $3 = 'buyer')
    )
    SELECT COUNT(DISTINCT CONCAT(party_type, ':', party_id))::int AS total_distinct_parties FROM history_union
  `;

  const [usersRes, totalsRes, monthPartiesRes] = await Promise.all([
    db.query(userQuery, params),
    db.query(totalsQuery, [year, month, party_type]),
    db.query(monthPartiesQuery, [year, month, party_type]),
  ]);

  // Transform rows to guaranteed 1..daysInMonth
  const transformedUsers = usersRes.rows.map((row) => {
    const dailyMap = {};
    for (let d = 1; d <= daysInMonth; d++) {
      dailyMap[d] = { changes_count: 0, parties_count: 0 };
    }

    if (Array.isArray(row.daily_stats)) {
      row.daily_stats.forEach((st) => {
        if (st && st.day >= 1 && st.day <= daysInMonth) {
          dailyMap[st.day] = {
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
      daily: dailyMap,
    };
  });

  const dayTotals = {};
  let overallMonthChanges = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    dayTotals[d] = { changes_count: 0, parties_count: 0 };
  }

  totalsRes.rows.forEach((r) => {
    const d = Number(r.day);
    if (d >= 1 && d <= daysInMonth) {
      const changes = Number(r.changes_count) || 0;
      const parties = Number(r.parties_count) || 0;
      dayTotals[d] = { changes_count: changes, parties_count: parties };
      overallMonthChanges += changes;
    }
  });

  const overallMonthParties = Number(monthPartiesRes.rows[0]?.total_distinct_parties) || 0;

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
    month,
    month_name: MONTH_NAMES[month - 1] || `Month ${month}`,
    days_in_month: daysInMonth,
    days: daysList,
    party_type,
    summary: {
      total_changes: overallMonthChanges,
      total_parties: overallMonthParties,
      active_users_count: activeUsersCount,
      total_users_count: transformedUsers.length,
      top_user: topUser,
    },
    day_totals: {
      ...dayTotals,
      month_changes: overallMonthChanges,
      month_parties: overallMonthParties,
    },
    users: transformedUsers,
  });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  query: Joi.object({
    user_id: Schema.uuid().optional(),
    year: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()),
    month: Joi.number().integer().min(1).max(12).default(() => new Date().getMonth() + 1),
    party_type: Joi.string().trim().valid('all', 'seller', 'buyer').default('all'),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { year, month, party_type } = req.customQuery;
  const requestedUserId = req.customQuery.user_id;

  // If user is admin and specifies user_id, allow them to view any user.
  // Otherwise, strictly force to the logged-in user's own id.
  const targetUserId =
    req.user?.role === 'admin' && requestedUserId ? requestedUserId : req.user.id;

  // 1. Fetch target user
  const userRes = await db.query(
    'SELECT id, name, email, phone, role FROM users WHERE id = $1 LIMIT 1',
    [targetUserId]
  );
  const targetUser = userRes.rows[0];
  if (!targetUser) {
    throw new ServerError('User not found', 404, ErrorCode.NOT_FOUND);
  }

  // 2. Fetch available years
  const yearsRes = await db.query(
    `SELECT DISTINCT year FROM (
       SELECT EXTRACT(YEAR FROM changed_at)::int AS year FROM seller_status_history WHERE changed_by = $1 AND changed_at IS NOT NULL
       UNION
       SELECT EXTRACT(YEAR FROM changed_at)::int AS year FROM buyer_status_history WHERE changed_by = $1 AND changed_at IS NOT NULL
     ) y
     ORDER BY year DESC`,
    [targetUserId]
  );
  let availableYears = yearsRes.rows.map((r) => r.year).filter(Boolean);
  if (!availableYears.includes(year)) {
    availableYears.unshift(year);
  }
  availableYears.sort((a, b) => b - a);

  // 3. Fetch assigned sellers count
  const assignedSellersRes = await db.query(
    'SELECT COUNT(*)::int AS count FROM user_assign_sellers WHERE user_id = $1',
    [targetUserId]
  );
  const assignedSellersCount = assignedSellersRes.rows[0]?.count || 0;

  // 4. Days in requested month
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysList = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    daysList.push({
      day: d,
      weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }),
      changes_count: 0,
      unique_parties_count: 0,
    });
  }

  // 5. Day-by-day query for the selected month
  const dailyStatsRes = await db.query(
    `WITH user_history AS (
       SELECT
         EXTRACT(DAY FROM changed_at)::int AS day,
         seller_id AS party_id
       FROM seller_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'seller')
       UNION ALL
       SELECT
         EXTRACT(DAY FROM changed_at)::int AS day,
         buyer_id AS party_id
       FROM buyer_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'buyer')
     )
     SELECT
       day,
       COUNT(*)::int AS changes_count,
       COUNT(DISTINCT party_id)::int AS unique_parties_count
     FROM user_history
     GROUP BY day
     ORDER BY day ASC`,
    [targetUserId, year, month, party_type]
  );

  let totalMonthChanges = 0;
  dailyStatsRes.rows.forEach((row) => {
    const idx = row.day - 1;
    if (daysList[idx]) {
      daysList[idx].changes_count = Number(row.changes_count) || 0;
      daysList[idx].unique_parties_count = Number(row.unique_parties_count) || 0;
      totalMonthChanges += Number(row.changes_count) || 0;
    }
  });

  // Unique parties in full month
  const monthUniqueRes = await db.query(
    `WITH user_month_history AS (
       SELECT seller_id AS party_id
       FROM seller_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'seller')
       UNION
       SELECT buyer_id AS party_id
       FROM buyer_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'buyer')
     )
     SELECT COUNT(DISTINCT party_id)::int AS count FROM user_month_history`,
    [targetUserId, year, month, party_type]
  );
  const totalMonthUniqueParties = monthUniqueRes.rows[0]?.count || 0;

  // 6. Today's stats
  const todayStatsRes = await db.query(
    `WITH today_history AS (
       SELECT seller_id AS party_id
       FROM seller_status_history
       WHERE changed_by = $1
         AND changed_at >= CURRENT_DATE
         AND ($2 = 'all' OR $2 = 'seller')
       UNION ALL
       SELECT buyer_id AS party_id
       FROM buyer_status_history
       WHERE changed_by = $1
         AND changed_at >= CURRENT_DATE
         AND ($2 = 'all' OR $2 = 'buyer')
     )
     SELECT
       COUNT(*)::int AS today_changes,
       COUNT(DISTINCT party_id)::int AS today_unique_parties
     FROM today_history`,
    [targetUserId, party_type]
  );
  const todayChanges = todayStatsRes.rows[0]?.today_changes || 0;
  const todayUniqueParties = todayStatsRes.rows[0]?.today_unique_parties || 0;

  // 7. Status breakdown for the month
  const statusBreakdownRes = await db.query(
    `WITH user_history AS (
       SELECT to_status
       FROM seller_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'seller')
       UNION ALL
       SELECT to_status
       FROM buyer_status_history
       WHERE changed_by = $1
         AND EXTRACT(YEAR FROM changed_at) = $2
         AND EXTRACT(MONTH FROM changed_at) = $3
         AND ($4 = 'all' OR $4 = 'buyer')
     )
     SELECT to_status, COUNT(*)::int AS count
     FROM user_history
     GROUP BY to_status
     ORDER BY count DESC`,
    [targetUserId, year, month, party_type]
  );
  const statusBreakdown = statusBreakdownRes.rows.map((r) => ({
    status: r.to_status,
    count: Number(r.count) || 0,
  }));

  // 8. Recent 20 activities for this user
  const recentActivitiesRes = await db.query(
    `WITH combined_history AS (
       SELECT
         h.id,
         h.seller_id AS party_id,
         'seller' AS party_type,
         s.company_name AS party_name,
         h.from_status,
         h.to_status,
         h.changed_at
       FROM seller_status_history h
       LEFT JOIN new_seller_details s ON s.id = h.seller_id
       WHERE h.changed_by = $1
         AND ($2 = 'all' OR $2 = 'seller')
       UNION ALL
       SELECT
         h.id,
         h.buyer_id AS party_id,
         'buyer' AS party_type,
         b.company_name AS party_name,
         h.from_status,
         h.to_status,
         h.changed_at
       FROM buyer_status_history h
       LEFT JOIN new_buyer_details b ON b.id = h.buyer_id
       WHERE h.changed_by = $1
         AND ($2 = 'all' OR $2 = 'buyer')
     )
     SELECT *
     FROM combined_history
     ORDER BY changed_at DESC
     LIMIT 20`,
    [targetUserId, party_type]
  );

  return res.status(200).json({
    user: targetUser,
    year,
    month,
    party_type,
    available_years: availableYears,
    assigned_sellers_count: assignedSellersCount,
    today_changes: todayChanges,
    today_unique_parties: todayUniqueParties,
    month_changes: totalMonthChanges,
    month_unique_parties: totalMonthUniqueParties,
    days: daysList,
    status_breakdown: statusBreakdown,
    recent_activities: recentActivitiesRes.rows,
  });
};

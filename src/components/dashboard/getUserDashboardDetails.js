const Joi = require('joi');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  query: Joi.object({
    user_id: Schema.uuid().optional(),
    year: Joi.number().integer().min(2000).max(2100).required(),
    month: Joi.number().integer().min(1).max(12).optional(),
    day: Joi.number().integer().min(1).max(31).optional(),
    party_type: Joi.string().trim().valid('all', 'seller', 'buyer').default('all'),
    view: Joi.string().trim().valid('transitions', 'parties').default('transitions'),
    status: Joi.string().trim().optional().allow(''),
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { year, month, day, party_type, view, page, limit, q, status } = req.customQuery;
  const requestedUserId = req.customQuery.user_id;

  // Admin can inspect other users; normal users are locked to their own ID.
  const targetUserId =
    req.user?.role === 'admin' && requestedUserId ? requestedUserId : req.user.id;

  const offset = (page - 1) * limit;

  const baseParams = [targetUserId, year];
  let extraFilters = '';

  if (month) {
    baseParams.push(month);
    extraFilters += ` AND EXTRACT(MONTH FROM h.changed_at) = $${baseParams.length}`;
  }

  if (day) {
    baseParams.push(day);
    extraFilters += ` AND EXTRACT(DAY FROM h.changed_at) = $${baseParams.length}`;
  }

  // Construct CTE
  let sellerPart = '';
  let buyerPart = '';

  if (party_type === 'all' || party_type === 'seller') {
    sellerPart = `
      SELECT
        h.id,
        h.seller_id AS party_id,
        'seller' AS party_type,
        s.company_name AS party_name,
        h.from_status,
        h.to_status,
        h.changed_by,
        h.changed_at
      FROM seller_status_history h
      LEFT JOIN new_seller_details s ON s.id = h.seller_id
      WHERE h.changed_by = $1
        AND EXTRACT(YEAR FROM h.changed_at) = $2
        ${extraFilters}
    `;
  }

  if (party_type === 'all' || party_type === 'buyer') {
    buyerPart = `
      SELECT
        h.id,
        h.buyer_id AS party_id,
        'buyer' AS party_type,
        b.company_name AS party_name,
        h.from_status,
        h.to_status,
        h.changed_by,
        h.changed_at
      FROM buyer_status_history h
      LEFT JOIN new_buyer_details b ON b.id = h.buyer_id
      WHERE h.changed_by = $1
        AND EXTRACT(YEAR FROM h.changed_at) = $2
        ${extraFilters}
    `;
  }

  let unionSql = '';
  if (sellerPart && buyerPart) {
    unionSql = `${sellerPart} UNION ALL ${buyerPart}`;
  } else {
    unionSql = sellerPart || buyerPart;
  }

  const queryParams = [...baseParams];
  let searchFilter = '';
  if (q && q.trim()) {
    queryParams.push(`%${q.trim()}%`);
    searchFilter = ` WHERE c.party_name ILIKE $${queryParams.length}`;
  }

  // Status breakdown query
  let statusCountsQuery = '';
  if (view === 'parties') {
    statusCountsQuery = `
      WITH combined AS (${unionSql}),
      party_latest AS (
        SELECT
          c.party_id,
          c.party_type,
          (ARRAY_AGG(c.to_status ORDER BY c.changed_at DESC))[1] AS current_status
        FROM combined c
        ${searchFilter}
        GROUP BY c.party_id, c.party_type
      )
      SELECT
        COALESCE(current_status, 'unknown') AS status,
        COUNT(*)::int AS count
      FROM party_latest
      WHERE current_status IS NOT NULL
      GROUP BY current_status
      ORDER BY count DESC, status ASC
    `;
  } else {
    const statusWhere = searchFilter ? `${searchFilter} AND c.to_status IS NOT NULL` : `WHERE c.to_status IS NOT NULL`;
    statusCountsQuery = `
      WITH combined AS (${unionSql})
      SELECT
        COALESCE(c.to_status, 'unknown') AS status,
        COUNT(*)::int AS count
      FROM combined c
      ${statusWhere}
      GROUP BY c.to_status
      ORDER BY count DESC, status ASC
    `;
  }

  const hasStatusFilter = Boolean(status && status.trim() && status !== 'all');
  const normalizedStatus = (status || '').trim();

  const dataParams = [...queryParams];
  let statusClauseTransitions = '';
  let statusClauseParties = '';

  if (hasStatusFilter) {
    if (normalizedStatus === 'call_not_received') {
      statusClauseTransitions = `c.to_status IN ('call_not_received', 'call_not_receive')`;
      statusClauseParties = `current_status IN ('call_not_received', 'call_not_receive')`;
    } else {
      dataParams.push(normalizedStatus);
      const paramIdx = dataParams.length;
      statusClauseTransitions = `c.to_status = $${paramIdx}`;
      statusClauseParties = `current_status = $${paramIdx}`;
    }
  }

  let countSql = '';
  let dataSql = '';

  if (view === 'parties') {
    // Unique parties aggregation
    const whereClause = hasStatusFilter ? `WHERE ${statusClauseParties}` : '';
    countSql = `
      WITH combined AS (${unionSql}),
      party_agg AS (
        SELECT
          c.party_id,
          c.party_type,
          (ARRAY_AGG(c.to_status ORDER BY c.changed_at DESC))[1] AS current_status
        FROM combined c
        ${searchFilter}
        GROUP BY c.party_id, c.party_type
      )
      SELECT COUNT(*)::int AS total
      FROM party_agg
      ${whereClause}
    `;

    dataParams.push(limit, offset);
    dataSql = `
      WITH combined AS (${unionSql}),
      party_agg AS (
        SELECT
          c.party_id,
          c.party_type,
          c.party_name,
          COUNT(*)::int AS total_transitions,
          MAX(c.changed_at) AS last_changed_at,
          (ARRAY_AGG(c.to_status ORDER BY c.changed_at DESC))[1] AS current_status
        FROM combined c
        ${searchFilter}
        GROUP BY c.party_id, c.party_type, c.party_name
      )
      SELECT *
      FROM party_agg
      ${whereClause}
      ORDER BY last_changed_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
  } else {
    let whereClause = searchFilter;
    if (hasStatusFilter) {
      whereClause = whereClause ? `${whereClause} AND ${statusClauseTransitions}` : `WHERE ${statusClauseTransitions}`;
    }

    countSql = `
      WITH combined AS (${unionSql})
      SELECT COUNT(*)::int AS total
      FROM combined c
      ${whereClause}
    `;

    dataParams.push(limit, offset);
    dataSql = `
      WITH combined AS (${unionSql}),
      with_prev AS (
        SELECT
          c.*,
          LEAD(c.changed_at) OVER (ORDER BY c.changed_at DESC, c.id DESC) AS prev_changed_at,
          ROUND(EXTRACT(EPOCH FROM (c.changed_at - LEAD(c.changed_at) OVER (ORDER BY c.changed_at DESC, c.id DESC))))::int AS duration_seconds
        FROM combined c
      )
      SELECT
        c.id,
        c.party_id,
        c.party_type,
        c.party_name,
        c.from_status,
        c.to_status,
        c.changed_at,
        c.duration_seconds,
        c.prev_changed_at
      FROM with_prev c
      ${whereClause}
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
  }

  const [countRes, statusCountsRes, dataRes] = await Promise.all([
    db.query(countSql, dataParams.slice(0, dataParams.length - 2)),
    db.query(statusCountsQuery, queryParams),
    db.query(dataSql, dataParams),
  ]);

  const statusCountsMap = new Map();
  for (const row of statusCountsRes.rows) {
    const rawStatus = row.status;
    const normalized = rawStatus === 'call_not_receive' ? 'call_not_received' : rawStatus;
    const curr = statusCountsMap.get(normalized) || 0;
    statusCountsMap.set(normalized, curr + Number(row.count || 0));
  }

  const statusCounts = Array.from(statusCountsMap.entries())
    .map(([st, cnt]) => ({ status: st, count: cnt }))
    .sort((a, b) => b.count - a.count);

  return res.status(200).json({
    data: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
    status: hasStatusFilter ? normalizedStatus : 'all',
    status_counts: statusCounts,
    page,
    limit,
    view,
  });
};

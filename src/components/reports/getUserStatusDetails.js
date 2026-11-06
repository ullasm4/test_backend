const Joi = require('joi');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  query: Joi.object({
    user_id: Schema.uuid().required(),
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
  const { user_id, year, month, day, party_type, view, page, limit, q, status } = req.customQuery;
  const offset = (page - 1) * limit;

  const baseParams = [user_id, year];
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

  // 1. Overall counts (transitions + unique parties)
  const countQuery = `
    WITH combined AS (
      ${unionSql}
    )
    SELECT
      COUNT(*)::int AS total_transitions,
      COUNT(DISTINCT CONCAT(c.party_type, ':', c.party_id))::int AS unique_parties
    FROM combined c
    ${searchFilter}
  `;

  // 2. Status-wise counts query (for current view)
  let statusCountsQuery = '';
  if (view === 'parties') {
    statusCountsQuery = `
      WITH combined AS (
        ${unionSql}
      ),
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
      WITH combined AS (
        ${unionSql}
      )
      SELECT
        COALESCE(c.to_status, 'unknown') AS status,
        COUNT(*)::int AS count
      FROM combined c
      ${statusWhere}
      GROUP BY c.to_status
      ORDER BY count DESC, status ASC
    `;
  }

  // 3. Status filter setup
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

  // Filtered count query (if status filter is active)
  let filteredCountQuery = null;
  const filteredCountParams = [...dataParams];

  if (hasStatusFilter) {
    if (view === 'parties') {
      filteredCountQuery = `
        WITH combined AS (
          ${unionSql}
        ),
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
        WHERE ${statusClauseParties}
      `;
    } else {
      const transitionsFilter = searchFilter
        ? `${searchFilter} AND ${statusClauseTransitions}`
        : `WHERE ${statusClauseTransitions}`;
      filteredCountQuery = `
        WITH combined AS (
          ${unionSql}
        )
        SELECT COUNT(*)::int AS total
        FROM combined c
        ${transitionsFilter}
      `;
    }
  }

  // 4. Data Query
  dataParams.push(limit, offset);
  let dataQuery = '';

  if (view === 'parties') {
    const whereClause = hasStatusFilter ? `WHERE ${statusClauseParties}` : '';
    dataQuery = `
      WITH combined AS (
        ${unionSql}
      ),
      party_agg AS (
        SELECT
          c.party_id,
          c.party_type,
          COALESCE(c.party_name, 'Unknown Party') AS party_name,
          COUNT(*)::int AS changes_count,
          MAX(c.changed_at) AS latest_changed_at,
          MIN(c.changed_at) AS first_changed_at,
          (ARRAY_AGG(c.from_status ORDER BY c.changed_at ASC))[1] AS initial_status,
          (ARRAY_AGG(c.to_status ORDER BY c.changed_at DESC))[1] AS current_status
        FROM combined c
        ${searchFilter}
        GROUP BY c.party_id, c.party_type, c.party_name
      )
      SELECT *
      FROM party_agg
      ${whereClause}
      ORDER BY changes_count DESC, latest_changed_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
  } else {
    let whereClause = searchFilter;
    if (hasStatusFilter) {
      whereClause = whereClause ? `${whereClause} AND ${statusClauseTransitions}` : `WHERE ${statusClauseTransitions}`;
    }

    dataQuery = `
      WITH combined AS (
        ${unionSql}
      ),
      with_prev AS (
        SELECT
          c.*,
          GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
            c.changed_at - LEAD(c.changed_at) OVER (ORDER BY c.changed_at DESC, c.id DESC)
          ))::numeric, 0)::int) AS duration_seconds,
          LEAD(c.changed_at) OVER (ORDER BY c.changed_at DESC, c.id DESC) AS prev_changed_at
        FROM combined c
      ),
      counted AS (
        SELECT
          c.id,
          c.party_id,
          c.party_type,
          COALESCE(c.party_name, 'Unknown Party') AS party_name,
          c.from_status,
          c.to_status,
          c.changed_at,
          c.changed_by,
          c.duration_seconds,
          c.prev_changed_at,
          COUNT(*) OVER(PARTITION BY c.party_type, c.party_id)::int AS party_changes_count
        FROM with_prev c
        ${whereClause}
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
        c.prev_changed_at,
        c.party_changes_count,
        u.name AS user_name
      FROM counted c
      LEFT JOIN users u ON u.id = c.changed_by
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
  }

  // Fetch count, status breakdown, and paginated items in parallel per workspace rules
  const queries = [
    db.query(countQuery, queryParams),
    db.query(statusCountsQuery, queryParams),
    db.query(dataQuery, dataParams),
  ];

  if (filteredCountQuery) {
    queries.push(db.query(filteredCountQuery, filteredCountParams));
  }

  const results = await Promise.all(queries);
  const countRes = results[0];
  const statusCountsRes = results[1];
  const dataRes = results[2];
  const filteredCountRes = results[3];

  const totalTransitions = countRes.rows[0]?.total_transitions || 0;
  const uniqueParties = countRes.rows[0]?.unique_parties || 0;

  let total = view === 'parties' ? uniqueParties : totalTransitions;
  if (hasStatusFilter && filteredCountRes) {
    total = filteredCountRes.rows[0]?.total || 0;
  }

  // Aggregate and normalize status counts
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
    total,
    total_transitions: totalTransitions,
    unique_parties: uniqueParties,
    view,
    status: hasStatusFilter ? normalizedStatus : 'all',
    status_counts: statusCounts,
    page,
    limit,
    items: dataRes.rows,
  });
};

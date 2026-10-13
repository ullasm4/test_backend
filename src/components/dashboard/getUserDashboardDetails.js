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
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { year, month, day, party_type, view, page, limit, q } = req.customQuery;
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

  if (view === 'parties') {
    // Unique parties aggregation
    const countSql = `
      WITH combined AS (${unionSql})
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT c.party_id
        FROM combined c
        ${searchFilter}
        GROUP BY c.party_id, c.party_type, c.party_name
      ) sub
    `;

    queryParams.push(limit, offset);
    const dataSql = `
      WITH combined AS (${unionSql})
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
      ORDER BY MAX(c.changed_at) DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
    `;

    const [countRes, dataRes] = await Promise.all([
      db.query(countSql, queryParams.slice(0, queryParams.length - 2)),
      db.query(dataSql, queryParams),
    ]);

    return res.status(200).json({
      data: dataRes.rows,
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
      view: 'parties',
    });
  }

  // Default view: transitions
  const countSql = `
    WITH combined AS (${unionSql})
    SELECT COUNT(*)::int AS total
    FROM combined c
    ${searchFilter}
  `;

  queryParams.push(limit, offset);
  const dataSql = `
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
    ${searchFilter}
    ORDER BY c.changed_at DESC, c.id DESC
    LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
  `;

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, queryParams.slice(0, queryParams.length - 2)),
    db.query(dataSql, queryParams),
  ]);

  return res.status(200).json({
    data: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
    view: 'transitions',
  });
};

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
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { user_id, year, month, day, party_type, view, page, limit, q } = req.customQuery;
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

  const dataParams = [...queryParams, limit, offset];
  let dataQuery = '';

  if (view === 'parties') {
    dataQuery = `
      WITH combined AS (
        ${unionSql}
      )
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
      ORDER BY changes_count DESC, latest_changed_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
  } else {
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
        ${searchFilter}
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

  // Fetch count and paginated items in parallel per workspace rules
  const [countRes, dataRes] = await Promise.all([
    db.query(countQuery, queryParams),
    db.query(dataQuery, dataParams),
  ]);

  const totalTransitions = countRes.rows[0]?.total_transitions || 0;
  const uniqueParties = countRes.rows[0]?.unique_parties || 0;
  const total = view === 'parties' ? uniqueParties : totalTransitions;

  return res.status(200).json({
    total,
    total_transitions: totalTransitions,
    unique_parties: uniqueParties,
    view,
    page,
    limit,
    items: dataRes.rows,
  });
};

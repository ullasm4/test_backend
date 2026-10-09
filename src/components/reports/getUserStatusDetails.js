const Joi = require('joi');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  query: Joi.object({
    user_id: Schema.uuid().required(),
    year: Joi.number().integer().min(2000).max(2100).required(),
    month: Joi.number().integer().min(1).max(12).optional(),
    day: Joi.number().integer().min(1).max(31).optional(),
    party_type: Joi.string().trim().valid('all', 'seller', 'buyer').default('all'),
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { user_id, year, month, day, party_type, page, limit, q } = req.customQuery;
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
    SELECT COUNT(*)::int AS total
    FROM combined c
    ${searchFilter}
  `;

  const dataParams = [...queryParams, limit, offset];
  const dataQuery = `
    WITH combined AS (
      ${unionSql}
    )
    SELECT
      c.id,
      c.party_id,
      c.party_type,
      COALESCE(c.party_name, 'Unknown Party') AS party_name,
      c.from_status,
      c.to_status,
      c.changed_at,
      u.name AS user_name
    FROM combined c
    LEFT JOIN users u ON u.id = c.changed_by
    ${searchFilter}
    ORDER BY c.changed_at DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
  `;

  // Fetch count and paginated items in parallel per workspace rules
  const [countRes, dataRes] = await Promise.all([
    db.query(countQuery, queryParams),
    db.query(dataQuery, dataParams),
  ]);

  const total = countRes.rows[0]?.total || 0;

  return res.status(200).json({
    total,
    page,
    limit,
    items: dataRes.rows,
  });
};

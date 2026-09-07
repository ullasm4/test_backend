const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { PRIMARY_SELLER_CONTACT, SELLER_LIST_COLUMNS } = require('@/lib/newTableSql');
const { getSellerMailCooldownsForRows } = require('@/service/mail/mailSendLimits');
const { getSellerWhatsAppCooldownsForRows } = require('@/service/whatsapp/whatsappSendLimits');
const { isEndUser } = require('@/middleware/auth');
const { parseUuidList } = require('@/lib/parseUuidList');

exports.validationSchema = {
  query: Joi.object({
    category: Joi.alternatives().try(
      Joi.string().trim(),
      Joi.array().items(Joi.string().trim())
    ).optional().allow(''),
    'category[]': Joi.alternatives().try(
      Joi.string().trim(),
      Joi.array().items(Joi.string().trim())
    ).optional().allow(''),
    categories: Joi.alternatives().try(
      Joi.string().trim(),
      Joi.array().items(Joi.string().trim())
    ).optional().allow(''),
    'categories[]': Joi.alternatives().try(
      Joi.string().trim(),
      Joi.array().items(Joi.string().trim())
    ).optional().allow(''),
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(100000),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    city_id: Schema.uuidList().optional().allow('', null),
    assigned: Joi.boolean().optional(),
    unassigned: Joi.boolean().optional(),
    sort_value: Joi.string().trim().optional().allow(''),
  }),
};

function assignedAtExpr(assignmentUserParamIndex) {
  if (assignmentUserParamIndex) {
    return `(SELECT uas.created_at FROM user_assign_sellers uas WHERE uas.seller_id = sd.id AND uas.user_id = $${assignmentUserParamIndex})`;
  }
  return `(SELECT uas.created_at FROM user_assign_sellers uas WHERE uas.seller_id = sd.id)`;
}

function orderBy(sortValue, { isUserRole = false, assignmentUserParamIndex = null } = {}) {
  const key = (sortValue || '').toLowerCase().trim();
  if (key === 'high_to_low' || key === 'desc') {
    return 'COALESCE(sd.total_value, 0) DESC, sd.company_name ASC NULLS LAST';
  }
  if (key === 'low_to_high' || key === 'asc') {
    return 'COALESCE(sd.total_value, 0) ASC, sd.company_name ASC NULLS LAST';
  }

  const assignedAt = assignedAtExpr(assignmentUserParamIndex);
  if (key === 'assigned_oldest' || key === 'assigned_asc') {
    return `${assignedAt} ASC NULLS LAST, sd.company_name ASC NULLS LAST`;
  }
  if (key === 'assigned_newest' || key === 'assigned_desc' || (isUserRole && !key)) {
    return `${assignedAt} DESC NULLS LAST, sd.company_name ASC NULLS LAST`;
  }

  return 'sd.total_contracts DESC NULLS LAST, sd.total_value DESC NULLS LAST, sd.company_name ASC NULLS LAST';
}

exports.controller = async (req, res, _next, db) => {
  const rawCat =
    req.customQuery.category ||
    req.customQuery['category[]'] ||
    req.customQuery.categories ||
    req.customQuery['categories[]'];
  let categoryList = [];
  if (Array.isArray(rawCat)) {
    categoryList = rawCat
      .flatMap((c) => String(c).split(','))
      .map((c) => c.trim())
      .filter(Boolean);
  } else if (typeof rawCat === 'string' && rawCat.trim()) {
    categoryList = rawCat
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }
  categoryList = Array.from(new Set(categoryList));

  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;

  if (categoryList.length === 0) {
    return res.status(200).json({
      category: '',
      categories: [],
      data: [],
      total: 0,
      stats: {
        total_sellers: 0,
        total_contracts: 0,
        total_value: 0,
      },
      page,
      limit,
    });
  }

  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const stateVal = (req.customQuery.state || '').trim();
  const cityIds = parseUuidList(req.customQuery.city_id);
  const assigned = req.customQuery.assigned === true || req.customQuery.assigned === 'true';
  const unassigned = req.customQuery.unassigned === true || req.customQuery.unassigned === 'true';
  const sortValue = (req.customQuery.sort_value || '').toLowerCase().trim();

  const params = [categoryList];
  const clauses = [
    `EXISTS (
      SELECT 1 FROM seller_category sc
      WHERE sc.category = ANY($1) AND (sc.seller_id = sd.id::text OR sc.seller_id = sd.seller_id)
    )`
  ];

  const isEndUserRole = isEndUser(req.user);
  const isUserRole = req.user && req.user.role !== 'admin' && !isEndUserRole;
  let assignmentUserParamIndex = null;
  if (isUserRole) {
    params.push(req.user.id);
    assignmentUserParamIndex = params.length;
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id AND uas.user_id = $${params.length}
    )`);
  }

  const rankedOrderBy = orderBy(sortValue, { isUserRole, assignmentUserParamIndex });

  if (unassigned) {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id
    )`);
  } else if (assigned) {
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id
    )`);
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      sd.company_name ILIKE $${params.length} OR
      sd.seller_id ILIKE $${params.length} OR
      EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND (
          x.email ILIKE $${params.length} OR
          x.phone ILIKE $${params.length} OR
          x.gst_number ILIKE $${params.length}
        )
      )
    )`);
  }

  if (stateVal) {
    let stateCode = stateVal.match(/\b\d{2}\b/)?.[0] || '';
    if (stateCode) {
      params.push(`${stateCode.trim()}%`);
      clauses.push(`EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND x.gst_number LIKE $${params.length}
      )`);
    }
  }

  if (cityIds.length) {
    params.push(cityIds);
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id
        AND x.city_id = ANY($${params.length}::uuid[])
    )`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  const countAndStatsSql = `
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(sd.total_contracts), 0)::bigint AS category_contracts,
      COALESCE(SUM(sd.total_value), 0)::numeric AS category_value
    FROM new_seller_details sd
    ${where}
  `;

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const dataSql = `
    WITH page AS (
      SELECT sd.id
      FROM new_seller_details sd
      ${where}
      ORDER BY ${rankedOrderBy}
      LIMIT $${limIdx} OFFSET $${offIdx}
    )
    SELECT ${SELLER_LIST_COLUMNS}
    FROM page p
    JOIN new_seller_details sd ON sd.id = p.id
    ${PRIMARY_SELLER_CONTACT}
    LEFT JOIN user_assign_sellers uas ON uas.seller_id = sd.id
    LEFT JOIN users u ON u.id = uas.user_id
    ORDER BY ${rankedOrderBy}
  `;

  const [statsRes, rowsRes] = await Promise.all([
    db.query(countAndStatsSql, params),
    db.query(dataSql, dataParams),
  ]);

  const rows = rowsRes.rows || [];
  const statsRow = statsRes.rows[0] || {};

  const [mailCooldownBySeller, whatsappCooldownBySeller] = await Promise.all([
    getSellerMailCooldownsForRows(db, rows),
    getSellerWhatsAppCooldownsForRows(db, rows),
  ]);

  const data = rows.map((row) => ({
    ...row,
    mail_cooldown: mailCooldownBySeller.get(row.id) || {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: 6,
    },
    whatsapp_cooldown: whatsappCooldownBySeller.get(row.id) || {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: 6,
    },
  }));

  return res.status(200).json({
    category: categoryList.join(', '),
    categories: categoryList,
    data,
    total: statsRow.total || 0,
    stats: {
      total_sellers: statsRow.total || 0,
      total_contracts: Number(statsRow.category_contracts || 0),
      total_value: Number(statsRow.category_value || 0),
    },
    page,
    limit,
  });
};

const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { LATEST_BUYER_CONTRACT } = require('@/lib/newTableSql');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');
const { isEndUser } = require('@/middleware/auth');
const { parseUuidList } = require('@/lib/parseUuidList');
const { getLeadStatusSchema, buyerStatusSelectSql } = require('@/lib/leadStatusSchema');

const stateCache = new Map();

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    city_id: Schema.uuidList().optional().allow('', null),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
    unique_gst: Joi.boolean().optional(),
    end_user_assigned: Joi.boolean().optional(),
    end_user_unassigned: Joi.boolean().optional(),
    assigned_end_user_id: Schema.uuid().optional().allow(''),
    sort_value: Joi.string().trim().optional().allow(''),
    value_op: Joi.string().trim().optional().allow(''),
    value_amount: Joi.number().optional().allow('', null),
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
  }),
};

function uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst }) {
  if (uniquePhone) return 'phone';
  if (uniqueEmail) return 'email';
  if (uniqueGst) return 'gst';
  return 'buyer';
}

exports.controller = async (req, res, _next, db) => {
  const leadSchema = await getLeadStatusSchema(db);
  const statusSelect = buyerStatusSelectSql(leadSchema.buyerStatus);
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const stateVal = (req.customQuery.state || '').trim();
  const cityIds = parseUuidList(req.customQuery.city_id);
  const hasPhone = req.customQuery.has_phone === true || req.customQuery.has_phone === 'true';
  const hasEmail = req.customQuery.has_email === true || req.customQuery.has_email === 'true';
  const uniquePhone = req.customQuery.unique_phone === true || req.customQuery.unique_phone === 'true';
  const uniqueEmail = req.customQuery.unique_email === true || req.customQuery.unique_email === 'true';
  const uniqueGst = req.customQuery.unique_gst === true || req.customQuery.unique_gst === 'true';
  const endUserAssigned =
    req.customQuery.end_user_assigned === true || req.customQuery.end_user_assigned === 'true';
  const endUserUnassigned =
    req.customQuery.end_user_unassigned === true || req.customQuery.end_user_unassigned === 'true';
  const assignedEndUserId = (req.customQuery.assigned_end_user_id || '').trim();
  const sortValue = (req.customQuery.sort_value || '').toLowerCase().trim();
  const valueOp = (req.customQuery.value_op || 'gte').toLowerCase().trim();
  const valueAmount = req.customQuery.value_amount;
  const valueRange = getValueRange(req.customQuery.value_range || '');
  const grain = uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst });

  const params = [];
  const clauses = [];

  const isEndUserRole = isEndUser(req.user);
  const isUserRole = req.user && req.user.role !== 'admin' && !isEndUserRole;
  if (isEndUserRole) {
    params.push(req.user.id);
    clauses.push(`b.id IN (
      SELECT beu.buyer_id FROM buyer_end_users beu WHERE beu.end_user_id = $${params.length}
    )`);
  } else if (isUserRole) {
    params.push(req.user.id);
    clauses.push(`EXISTS (
      SELECT 1 FROM new_contracts c
      JOIN user_assign_sellers uas ON uas.seller_id = c.seller_id
      WHERE c.buyer_id = b.id AND uas.user_id = $${params.length}
    )`);
  }

  if (!isEndUserRole) {
    if (assignedEndUserId && endUserUnassigned) {
      // Buyers not yet assigned to this end user (may already be assigned to others)
      params.push(assignedEndUserId);
      clauses.push(`NOT EXISTS (
        SELECT 1 FROM buyer_end_users beu
        WHERE beu.buyer_id = b.id AND beu.end_user_id = $${params.length}
      )`);
    } else if (assignedEndUserId) {
      params.push(assignedEndUserId);
      clauses.push(`EXISTS (
        SELECT 1 FROM buyer_end_users beu
        WHERE beu.buyer_id = b.id AND beu.end_user_id = $${params.length}
      )`);
    } else if (endUserUnassigned) {
      clauses.push(`NOT EXISTS (
        SELECT 1 FROM buyer_end_users beu WHERE beu.buyer_id = b.id
      )`);
    } else if (endUserAssigned) {
      clauses.push(`EXISTS (
        SELECT 1 FROM buyer_end_users beu WHERE beu.buyer_id = b.id
      )`);
    }
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      b.company_name ILIKE $${params.length} OR
      b.email ILIKE $${params.length} OR
      b.phone ILIKE $${params.length} OR
      b.gst_number ILIKE $${params.length} OR
      EXISTS (
        SELECT 1 FROM new_contracts c
        WHERE c.buyer_id = b.id AND c.contract_number ILIKE $${params.length}
      )
    )`);
  }

  if (stateVal) {
    let stateCode = '';
    const match = stateVal.match(/\b\d{2}\b/) || stateVal.match(/\d{2}/);
    if (match) {
      stateCode = match[0];
    } else {
      const cacheKey = stateVal.toLowerCase();
      if (stateCache.has(cacheKey)) {
        stateCode = stateCache.get(cacheKey);
      } else {
        const stateRes = await db.query(
          `SELECT gst_code FROM states WHERE LOWER(name) ILIKE LOWER($1) OR name ILIKE $2 LIMIT 1`,
          [stateVal, `%${stateVal}%`]
        );
        if (stateRes.rows[0]?.gst_code) {
          stateCode = stateRes.rows[0].gst_code;
          stateCache.set(cacheKey, stateCode);
        }
      }
    }
    if (stateCode) {
      params.push(`${stateCode.trim()}%`);
      clauses.push(`b.gst_number LIKE $${params.length}`);
    }
  }

  if (cityIds.length) {
    params.push(cityIds);
    clauses.push(`b.city_id = ANY($${params.length}::uuid[])`);
  }

  if (hasPhone || uniquePhone) {
    clauses.push(`b.phone IS NOT NULL AND BTRIM(b.phone) <> ''`);
  }

  if (hasEmail || uniqueEmail) {
    clauses.push(`b.email IS NOT NULL AND BTRIM(b.email) <> ''`);
  }

  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`b.gst_number IS NOT NULL AND BTRIM(b.gst_number) <> ''`);
  }

  if (valueRange) {
    const rangeClause = valueRangeSql(valueRange, params, 'COALESCE(b.total_value, 0)');
    if (rangeClause) clauses.push(rangeClause);
  } else if (valueAmount !== undefined && valueAmount !== null && valueAmount !== '') {
    const valAmt = Number(valueAmount);
    if (!Number.isNaN(valAmt)) {
      params.push(valAmt);
      if (valueOp === 'lte' || valueOp === 'less_than' || valueOp === '<') {
        clauses.push(`COALESCE(b.total_value, 0) <= $${params.length}`);
      } else if (valueOp === 'eq' || valueOp === 'equal' || valueOp === '=') {
        clauses.push(`COALESCE(b.total_value, 0) = $${params.length}`);
      } else {
        clauses.push(`COALESCE(b.total_value, 0) >= $${params.length}`);
      }
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const unfiltered =
    !isUserRole &&
    !isEndUserRole &&
    !q &&
    !stateVal &&
    !cityIds.length &&
    !hasPhone &&
    !hasEmail &&
    !uniquePhone &&
    !uniqueEmail &&
    !uniqueGst &&
    !endUserAssigned &&
    !endUserUnassigned &&
    !assignedEndUserId &&
    !valueRange &&
    (valueAmount === undefined || valueAmount === null || valueAmount === '');
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;
  let orderBy = 'b.total_contracts DESC NULLS LAST, b.total_value DESC NULLS LAST, b.company_name ASC NULLS LAST';
  if (sortValue === 'high_to_low' || sortValue === 'desc') {
    orderBy = 'COALESCE(b.total_value, 0) DESC, b.company_name ASC NULLS LAST';
  } else if (sortValue === 'low_to_high' || sortValue === 'asc') {
    orderBy = 'COALESCE(b.total_value, 0) ASC, b.company_name ASC NULLS LAST';
  }

  const selectCols = `
    b.id, b.company_name, b.phone, b.email, b.address, b.city_id, c.name AS city, b.gst_number,
    ${statusSelect},
    COALESCE(b.total_value, 0) AS total_value,
    COALESCE(b.total_contracts, 0)::int AS total_contracts,
    (b.phone IS NOT NULL AND BTRIM(b.phone) <> '') AS is_mobile,
    (b.email IS NOT NULL AND BTRIM(b.email) <> '') AS is_email,
    lc.contract_id, lc.contract_number
  `;

  let countSql;
  let countParams = params;
  let dataSql;

  if (grain === 'buyer') {
    countSql = unfiltered
      ? `SELECT COALESCE(new_buyers, 0)::int AS total FROM total_counts WHERE id = 1`
      : `SELECT COUNT(*)::int AS total FROM new_buyer_details b ${where}`;
    countParams = unfiltered ? [] : params;
    dataSql = `
      WITH page AS (
        SELECT b.id
        FROM new_buyer_details b
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${limIdx} OFFSET $${offIdx}
      )
      SELECT ${selectCols}
      FROM page p
      JOIN new_buyer_details b ON b.id = p.id
      LEFT JOIN cities c ON c.id = b.city_id
      ${LATEST_BUYER_CONTRACT}
      ORDER BY ${orderBy}
    `;
  } else {
    const distinctExpr =
      grain === 'phone'
        ? `LOWER(BTRIM(b.phone))`
        : grain === 'email'
          ? `LOWER(BTRIM(b.email))`
          : `LOWER(BTRIM(b.gst_number))`;

    countSql = `
      SELECT COUNT(*)::int AS total FROM (
        SELECT DISTINCT ${distinctExpr}
        FROM new_buyer_details b
        ${where}
      ) t
    `;
    dataSql = `
      WITH ranked AS (
        SELECT DISTINCT ON (${distinctExpr})
          ${selectCols}
        FROM new_buyer_details b
        LEFT JOIN cities c ON c.id = b.city_id
        ${LATEST_BUYER_CONTRACT}
        ${where}
        ORDER BY ${distinctExpr}, ${orderBy}, b.id
      )
      SELECT * FROM ranked
      ORDER BY COALESCE(total_contracts, 0) DESC, COALESCE(total_value, 0) DESC, company_name ASC NULLS LAST
      LIMIT $${limIdx} OFFSET $${offIdx}
    `;
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0]?.total || 0, page, limit });
};

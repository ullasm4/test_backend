const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');

const stateCache = new Map();

const IDENTITY_NEWER = `
  LOWER(BTRIM(COALESCE(d.company_name, ''))) = LOWER(BTRIM(COALESCE(s.company_name, '')))
  AND LOWER(BTRIM(COALESCE(d.phone, ''))) = LOWER(BTRIM(COALESCE(s.phone, '')))
  AND LOWER(BTRIM(COALESCE(d.email, ''))) = LOWER(BTRIM(COALESCE(s.email, '')))
  AND d.created_at > s.created_at
`;

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
    unique_gst: Joi.boolean().optional(),
    sort_value: Joi.string().trim().optional().allow(''),
    value_op: Joi.string().trim().optional().allow(''),
    value_amount: Joi.number().optional().allow('', null),
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
  }),
};

function uniqueNewerSql({ uniquePhone, uniqueEmail, uniqueGst }) {
  if (uniquePhone) {
    return `d.is_mobile = true AND d.phone IS NOT DISTINCT FROM s.phone AND d.created_at > s.created_at`;
  }
  if (uniqueEmail) {
    return `d.is_email = true AND d.email IS NOT DISTINCT FROM s.email AND d.created_at > s.created_at`;
  }
  if (uniqueGst) {
    return `d.gst_number IS NOT NULL AND d.gst_number <> '' AND LOWER(BTRIM(d.gst_number)) = LOWER(BTRIM(s.gst_number)) AND d.created_at > s.created_at`;
  }
  return IDENTITY_NEWER;
}

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const stateVal = (req.customQuery.state || '').trim();
  const hasPhone = req.customQuery.has_phone === true || req.customQuery.has_phone === 'true';
  const hasEmail = req.customQuery.has_email === true || req.customQuery.has_email === 'true';
  const uniquePhone = req.customQuery.unique_phone === true || req.customQuery.unique_phone === 'true';
  const uniqueEmail = req.customQuery.unique_email === true || req.customQuery.unique_email === 'true';
  const uniqueGst = req.customQuery.unique_gst === true || req.customQuery.unique_gst === 'true';
  const sortValue = (req.customQuery.sort_value || req.customQuery.sort || '').toLowerCase().trim();
  const valueOp = (req.customQuery.value_op || 'gte').toLowerCase().trim();
  const valueAmount = req.customQuery.value_amount;
  const valueRangeKey = req.customQuery.value_range || '';
  const valueRange = getValueRange(valueRangeKey);

  let rankedOrderBy = 's.created_at DESC';
  let sortByValue = false;

  if (sortValue === 'high_to_low' || sortValue === 'desc') {
    rankedOrderBy = 'COALESCE(stv.total_value, 0) DESC, s.created_at DESC';
    sortByValue = true;
  } else if (sortValue === 'low_to_high' || sortValue === 'asc') {
    rankedOrderBy = 'COALESCE(stv.total_value, 0) ASC, s.created_at DESC';
    sortByValue = true;
  }

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      s.company_name ILIKE $${params.length} OR
      s.email ILIKE $${params.length} OR
      s.phone ILIKE $${params.length} OR
      s.gst_number ILIKE $${params.length} OR
      s.seller_id ILIKE $${params.length}
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
      clauses.push(`s.gst_number LIKE $${params.length}`);
    }
  }

  if (hasPhone || uniquePhone) {
    clauses.push('s.is_mobile = true');
  }

  if (hasEmail || uniqueEmail) {
    clauses.push('s.is_email = true');
  }

  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`s.gst_number IS NOT NULL AND s.gst_number <> ''`);
  }

  let hasValueFilter = Boolean(valueRange);
  if (!valueRange && valueAmount !== undefined && valueAmount !== null && valueAmount !== '') {
    const valAmt = Number(valueAmount);
    if (!Number.isNaN(valAmt)) {
      hasValueFilter = true;
      params.push(valAmt);
      if (valueOp === 'lte' || valueOp === 'less_than' || valueOp === '<') {
        clauses.push(`COALESCE(stv.total_value, 0) <= $${params.length}`);
      } else if (valueOp === 'eq' || valueOp === 'equal' || valueOp === '=') {
        clauses.push(`COALESCE(stv.total_value, 0) = $${params.length}`);
      } else {
        clauses.push(`COALESCE(stv.total_value, 0) >= $${params.length}`);
      }
    }
  }

  const rangeClause = valueRangeSql(valueRange, params, 'COALESCE(stv.total_value, 0)');
  if (rangeClause) clauses.push(rangeClause);

  clauses.push(`NOT EXISTS (SELECT 1 FROM sellers d WHERE ${uniqueNewerSql({ uniquePhone, uniqueEmail, uniqueGst })})`);

  const where = `WHERE ${clauses.join(' AND ')}`;
  const needsStv = hasValueFilter || sortByValue;
  const stvJoin = 'LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id';
  const unfilteredIdentity = !q && !stateVal && !hasPhone && !hasEmail && !uniquePhone && !uniqueEmail && !uniqueGst && !hasValueFilter;

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const countSql = unfilteredIdentity
    ? `SELECT COALESCE(unique_sellers, 0)::int AS total FROM total_counts WHERE id = 1`
    : `SELECT COUNT(*)::int AS total FROM sellers s ${hasValueFilter ? stvJoin : ''} ${where}`;
  const countParams = unfilteredIdentity ? [] : params;

  const dataSql = needsStv
    ? `SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address,
              s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at,
              COALESCE(stv.total_value, 0) AS total_value
       FROM sellers s
       ${stvJoin}
       ${where}
       ORDER BY ${rankedOrderBy}
       LIMIT $${limIdx} OFFSET $${offIdx}`
    : `WITH page AS (
         SELECT s.id
         FROM sellers s
         ${where}
         ORDER BY s.created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}
       )
       SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address,
              s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at,
              COALESCE(stv.total_value, 0) AS total_value
       FROM page p
       JOIN sellers s ON s.id = p.id
       LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id
       ORDER BY s.created_at DESC`;

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0]?.total || 0, page, limit });
};

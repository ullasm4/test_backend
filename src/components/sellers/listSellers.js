const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

const stateCache = new Map();

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
    sort_value: Joi.string().trim().optional().allow(''),
    value_op: Joi.string().trim().optional().allow(''),
    value_amount: Joi.number().optional().allow('', null),
  }),
};

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
  const sortValue = (req.customQuery.sort_value || req.customQuery.sort || '').toLowerCase().trim();
  const valueOp = (req.customQuery.value_op || 'gte').toLowerCase().trim();
  const valueAmount = req.customQuery.value_amount;

  let orderBy = 'ORDER BY s.created_at DESC';
  let rankedOrderBy = 'ORDER BY created_at DESC';

  if (sortValue === 'high_to_low' || sortValue === 'desc') {
    orderBy = 'ORDER BY COALESCE(stv.total_value, 0) DESC, s.created_at DESC';
    rankedOrderBy = 'ORDER BY total_value DESC, created_at DESC';
  } else if (sortValue === 'low_to_high' || sortValue === 'asc') {
    orderBy = 'ORDER BY COALESCE(stv.total_value, 0) ASC, s.created_at DESC';
    rankedOrderBy = 'ORDER BY total_value ASC, created_at DESC';
  }

  const params = [];
  const clauses = [];
  let joinClause = '';

  if (q) {
    params.push(`%${q}%`);
    joinClause = '';
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
      clauses.push(`s.gst_number ILIKE $${params.length}`);
    }
  }

  if (hasPhone || uniquePhone) {
    clauses.push("s.is_mobile = true");
  }

  if (hasEmail || uniqueEmail) {
    clauses.push("s.is_email = true");
  }

  let hasValueFilter = false;
  if (valueAmount !== undefined && valueAmount !== null && valueAmount !== '') {
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

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countJoin = hasValueFilter ? `LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id ${joinClause}` : joinClause;
  let countSql = `SELECT COUNT(*)::int AS total FROM sellers s ${countJoin} ${where}`;
  let dataSql = `SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, COALESCE(stv.total_value, 0) AS total_value
     FROM sellers s
     LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id
     ${where}
     ${orderBy}
     LIMIT $${limIdx} OFFSET $${offIdx}`;

  if (uniquePhone) {
    countSql = `SELECT COUNT(DISTINCT s.phone)::int AS total FROM sellers s ${countJoin} ${where}`;
    dataSql = `WITH ranked AS (
      SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, COALESCE(stv.total_value, 0) AS total_value,
             ROW_NUMBER() OVER (PARTITION BY s.phone ORDER BY s.created_at DESC) as rn
      FROM sellers s
      LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id
      ${where}
    )
    SELECT id, contract_id, seller_id, company_name, phone, email, address, msme_certificate_number, gst_number, is_mobile, is_email, created_at, updated_at, total_value
    FROM ranked
    WHERE rn = 1
    ${rankedOrderBy}
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  } else if (uniqueEmail) {
    countSql = `SELECT COUNT(DISTINCT s.email)::int AS total FROM sellers s ${countJoin} ${where}`;
    dataSql = `WITH ranked AS (
      SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, COALESCE(stv.total_value, 0) AS total_value,
             ROW_NUMBER() OVER (PARTITION BY s.email ORDER BY s.created_at DESC) as rn
      FROM sellers s
      LEFT JOIN seller_total_value stv ON stv.seller_id = s.seller_id
      ${where}
    )
    SELECT id, contract_id, seller_id, company_name, phone, email, address, msme_certificate_number, gst_number, is_mobile, is_email, created_at, updated_at, total_value
    FROM ranked
    WHERE rn = 1
    ${rankedOrderBy}
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0].total, page, limit });
};

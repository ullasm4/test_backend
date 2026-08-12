const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const hasPhone = req.customQuery.has_phone === true || req.customQuery.has_phone === 'true';
  const hasEmail = req.customQuery.has_email === true || req.customQuery.has_email === 'true';
  const uniquePhone = req.customQuery.unique_phone === true || req.customQuery.unique_phone === 'true';
  const uniqueEmail = req.customQuery.unique_email === true || req.customQuery.unique_email === 'true';

  const params = [];
  const clauses = [];
  let joinClause = '';

  if (q) {
    params.push(`%${q}%`);
    joinClause = 'LEFT JOIN contracts c ON c.id = b.contract_id';
    clauses.push(`(
      b.company_name ILIKE $${params.length} OR
      b.email ILIKE $${params.length} OR
      b.phone ILIKE $${params.length} OR
      b.gst_number ILIKE $${params.length} OR
      c.contract_number ILIKE $${params.length}
    )`);
  }

  if (hasPhone || uniquePhone) {
    clauses.push('b.is_mobile = true');
  }

  if (hasEmail || uniqueEmail) {
    clauses.push('b.is_email = true');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql = where
    ? `SELECT COUNT(*)::int AS total FROM buyers b ${joinClause} ${where}`
    : `SELECT COALESCE(total_buyers, 0)::int AS total FROM total_counts WHERE id = 1`;
  let countParams = where ? params : [];

  // Page ids via created_at index first, then join contract_number
  let dataSql = `
    WITH page AS (
      SELECT b.id
      FROM buyers b
      ${joinClause}
      ${where}
      ORDER BY b.created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
    )
    SELECT b.id, b.contract_id, b.company_name, b.phone, b.email, b.address, b.gst_number,
           b.is_mobile, b.is_email, b.created_at, b.updated_at, c.contract_number
    FROM page p
    JOIN buyers b ON b.id = p.id
    LEFT JOIN contracts c ON c.id = b.contract_id
    ORDER BY b.created_at DESC
  `;

  if (uniquePhone) {
    countSql = `SELECT COUNT(DISTINCT LOWER(TRIM(b.phone)))::int AS total FROM buyers b ${joinClause} ${where}`;
    countParams = params;
    dataSql = `WITH ranked AS (
      SELECT b.id, b.contract_id, b.company_name, b.phone, b.email, b.address, b.gst_number,
             b.is_mobile, b.is_email, b.created_at, b.updated_at, c.contract_number,
             ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(b.phone)) ORDER BY b.created_at DESC) AS rn
      FROM buyers b
      LEFT JOIN contracts c ON c.id = b.contract_id
      ${where}
    )
    SELECT id, contract_id, company_name, phone, email, address, gst_number, is_mobile, is_email,
           created_at, updated_at, contract_number
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  } else if (uniqueEmail) {
    countSql = `SELECT COUNT(DISTINCT LOWER(TRIM(b.email)))::int AS total FROM buyers b ${joinClause} ${where}`;
    countParams = params;
    dataSql = `WITH ranked AS (
      SELECT b.id, b.contract_id, b.company_name, b.phone, b.email, b.address, b.gst_number,
             b.is_mobile, b.is_email, b.created_at, b.updated_at, c.contract_number,
             ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(b.email)) ORDER BY b.created_at DESC) AS rn
      FROM buyers b
      LEFT JOIN contracts c ON c.id = b.contract_id
      ${where}
    )
    SELECT id, contract_id, company_name, phone, email, address, gst_number, is_mobile, is_email,
           created_at, updated_at, contract_number
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0]?.total || 0, page, limit });
};

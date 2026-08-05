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
    joinClause = 'LEFT JOIN contracts c ON c.id = s.contract_id';
    clauses.push(`(
      s.company_name ILIKE $${params.length} OR
      s.email ILIKE $${params.length} OR
      s.phone ILIKE $${params.length} OR
      s.gst_number ILIKE $${params.length} OR
      s.seller_id ILIKE $${params.length} OR
      c.contract_number ILIKE $${params.length}
    )`);
  }

  if (hasPhone || uniquePhone) {
    clauses.push("s.is_mobile = true");
  }

  if (hasEmail || uniqueEmail) {
    clauses.push("s.is_email = true");
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql = `SELECT COUNT(*)::int AS total FROM sellers s ${joinClause} ${where}`;
  let dataSql = `SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, c.contract_number
     FROM sellers s
     LEFT JOIN contracts c ON c.id = s.contract_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`;

  if (uniquePhone) {
    countSql = `SELECT COUNT(DISTINCT LOWER(TRIM(s.phone)))::int AS total FROM sellers s ${joinClause} ${where}`;
    dataSql = `WITH ranked AS (
      SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, c.contract_number,
             ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(s.phone)) ORDER BY s.created_at DESC) as rn
      FROM sellers s
      LEFT JOIN contracts c ON c.id = s.contract_id
      ${where}
    )
    SELECT id, contract_id, seller_id, company_name, phone, email, address, msme_certificate_number, gst_number, is_mobile, is_email, created_at, updated_at, contract_number
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  } else if (uniqueEmail) {
    countSql = `SELECT COUNT(DISTINCT LOWER(TRIM(s.email)))::int AS total FROM sellers s ${joinClause} ${where}`;
    dataSql = `WITH ranked AS (
      SELECT s.id, s.contract_id, s.seller_id, s.company_name, s.phone, s.email, s.address, s.msme_certificate_number, s.gst_number, s.is_mobile, s.is_email, s.created_at, s.updated_at, c.contract_number,
             ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(s.email)) ORDER BY s.created_at DESC) as rn
      FROM sellers s
      LEFT JOIN contracts c ON c.id = s.contract_id
      ${where}
    )
    SELECT id, contract_id, seller_id, company_name, phone, email, address, msme_certificate_number, gst_number, is_mobile, is_email, created_at, updated_at, contract_number
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}`;
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0].total, page, limit });
};

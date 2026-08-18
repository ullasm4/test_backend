const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

const IDENTITY_NEWER = `
  LOWER(BTRIM(COALESCE(d.company_name, ''))) = LOWER(BTRIM(COALESCE(b.company_name, '')))
  AND LOWER(BTRIM(COALESCE(d.phone, ''))) = LOWER(BTRIM(COALESCE(b.phone, '')))
  AND LOWER(BTRIM(COALESCE(d.email, ''))) = LOWER(BTRIM(COALESCE(b.email, '')))
  AND d.created_at > b.created_at
`;

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
    unique_gst: Joi.boolean().optional(),
  }),
};

function uniqueNewerSql({ uniquePhone, uniqueEmail, uniqueGst }) {
  if (uniquePhone) {
    return `d.is_mobile = true AND LOWER(BTRIM(COALESCE(d.phone, ''))) = LOWER(BTRIM(COALESCE(b.phone, ''))) AND d.created_at > b.created_at`;
  }
  if (uniqueEmail) {
    return `d.is_email = true AND LOWER(BTRIM(COALESCE(d.email, ''))) = LOWER(BTRIM(COALESCE(b.email, ''))) AND d.created_at > b.created_at`;
  }
  if (uniqueGst) {
    return `d.gst_number IS NOT NULL AND d.gst_number <> '' AND LOWER(BTRIM(d.gst_number)) = LOWER(BTRIM(b.gst_number)) AND d.created_at > b.created_at`;
  }
  return IDENTITY_NEWER;
}

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const hasPhone = req.customQuery.has_phone === true || req.customQuery.has_phone === 'true';
  const hasEmail = req.customQuery.has_email === true || req.customQuery.has_email === 'true';
  const uniquePhone = req.customQuery.unique_phone === true || req.customQuery.unique_phone === 'true';
  const uniqueEmail = req.customQuery.unique_email === true || req.customQuery.unique_email === 'true';
  const uniqueGst = req.customQuery.unique_gst === true || req.customQuery.unique_gst === 'true';

  const params = [];
  const clauses = [];
  let searchJoin = '';

  if (q) {
    params.push(`%${q}%`);
    searchJoin = 'LEFT JOIN contracts c ON c.id = b.contract_id';
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

  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`b.gst_number IS NOT NULL AND b.gst_number <> ''`);
  }

  clauses.push(`NOT EXISTS (SELECT 1 FROM buyers d WHERE ${uniqueNewerSql({ uniquePhone, uniqueEmail, uniqueGst })})`);

  const where = `WHERE ${clauses.join(' AND ')}`;
  const unfilteredIdentity = !q && !hasPhone && !hasEmail && !uniquePhone && !uniqueEmail && !uniqueGst;

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const countSql = unfilteredIdentity
    ? `SELECT COALESCE(unique_buyers, 0)::int AS total FROM total_counts WHERE id = 1`
    : `SELECT COUNT(*)::int AS total FROM buyers b ${searchJoin} ${where}`;
  const countParams = unfilteredIdentity ? [] : params;

  const dataSql = `
    WITH page AS (
      SELECT b.id
      FROM buyers b
      ${searchJoin}
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

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({ data: rowsRes.rows, total: countRes.rows[0]?.total || 0, page, limit });
};

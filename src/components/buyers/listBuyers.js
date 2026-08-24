const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { LATEST_BUYER_CONTRACT } = require('@/lib/newTableSql');

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

function uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst }) {
  if (uniquePhone) return 'phone';
  if (uniqueEmail) return 'email';
  if (uniqueGst) return 'gst';
  return 'buyer';
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
  const grain = uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst });

  const params = [];
  const clauses = [];

  const isUserRole = req.user && req.user.role !== 'admin';
  if (isUserRole) {
    params.push(req.user.id);
    clauses.push(`EXISTS (
      SELECT 1 FROM new_contracts c
      JOIN user_assign_sellers uas ON uas.seller_id = c.seller_id
      WHERE c.buyer_id = b.id AND uas.user_id = $${params.length}
    )`);
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

  if (hasPhone || uniquePhone) {
    clauses.push(`b.phone IS NOT NULL AND BTRIM(b.phone) <> ''`);
  }

  if (hasEmail || uniqueEmail) {
    clauses.push(`b.email IS NOT NULL AND BTRIM(b.email) <> ''`);
  }

  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`b.gst_number IS NOT NULL AND BTRIM(b.gst_number) <> ''`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const unfiltered = !isUserRole && !q && !hasPhone && !hasEmail && !uniquePhone && !uniqueEmail && !uniqueGst;
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;
  const orderBy = 'b.total_contracts DESC NULLS LAST, b.total_value DESC NULLS LAST, b.company_name ASC NULLS LAST';

  const selectCols = `
    b.id, b.company_name, b.phone, b.email, b.address, b.gst_number,
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

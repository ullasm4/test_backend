const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { enrichContract } = require('@/lib/contractHelpers');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.contractsMaxLimit).default(10),
    q: Schema.search(),
    ministry_id: Schema.uuid().allow(''),
    status: Joi.string().trim().max(100).allow(''),
    from: Schema.dateOnly().allow(''),
    to: Schema.dateOnly().allow(''),
    sort: Joi.string().trim().optional().allow(''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const status = req.customQuery.status || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';
  const sort = (req.customQuery.sort || '').toLowerCase().trim();

  let orderBy = 'ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC';
  if (sort === 'high_to_low' || sort === 'value_desc') {
    orderBy = 'ORDER BY c.total_value DESC NULLS LAST, c.created_at DESC';
  } else if (sort === 'low_to_high' || sort === 'value_asc') {
    orderBy = 'ORDER BY c.total_value ASC NULLS LAST, c.created_at DESC';
  } else if (sort === 'oldest' || sort === 'date_asc') {
    orderBy = 'ORDER BY c.contract_date ASC NULLS FIRST, c.created_at ASC';
  }

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      c.contract_number ILIKE $${params.length} OR
      c.seller_id ILIKE $${params.length} OR
      c.seller_company ILIKE $${params.length} OR
      c.buyer_company ILIKE $${params.length} OR
      c.org_name ILIKE $${params.length} OR
      c.bid_number ILIKE $${params.length} OR
      c.department ILIKE $${params.length} OR
      c.status_of_the_contract ILIKE $${params.length} OR
      m.name ILIKE $${params.length}
    )`);
  }

  if (ministryId) {
    params.push(ministryId);
    clauses.push(`c.ministry_id = $${params.length}`);
  }

  if (status) {
    params.push(`%${status}%`);
    clauses.push(`c.status_of_the_contract ILIKE $${params.length}`);
  }

  if (from) {
    params.push(from);
    clauses.push(`c.contract_date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    clauses.push(`c.contract_date <= $${params.length}::date`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const countSql = where
    ? `SELECT COUNT(c.id)::int AS total
       FROM contracts c
       ${q ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : ''}
       ${where}`
    : `SELECT COALESCE(total_contracts, 0)::int AS total FROM total_counts WHERE id = 1`;

  const countParams = where ? params : [];

  // Execute count and data query in parallel, omitting full_html for fast execution
  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(
      `SELECT
         c.id, c.contract_number, c.org_type, c.org_name, c.buyer_designation,
         c.total_value, c.bid_number, c.department, c.office_zone,
         c.status_of_the_contract, c.order_id, c.contract_pdf_url,
         c.products, c.buyer_company, c.seller_company, c.seller_id,
         c.contract_date, c.created_at, c.updated_at, m.name AS ministry_name
       FROM contracts c
       LEFT JOIN contract_ministry m ON m.id = c.ministry_id
       ${where}
       ${orderBy}
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      dataParams
    ),
  ]);

  const data = rowsRes.rows.map((r) => enrichContract(r));

  return res.status(200).json({ data, total: countRes.rows[0]?.total || 0, page, limit });
};

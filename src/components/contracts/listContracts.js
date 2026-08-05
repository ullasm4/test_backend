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
    from: Schema.dateOnly().allow(''),
    to: Schema.dateOnly().allow(''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      c.contract_number ILIKE $${params.length} OR
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

  if (from) {
    params.push(from);
    clauses.push(`c.contract_date::date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    clauses.push(`c.contract_date::date <= $${params.length}::date`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countRes = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM contracts c
     LEFT JOIN contract_ministry m ON m.id = c.ministry_id
     ${where}`,
    params
  );

  params.push(limit, offset);
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const { rows } = await db.query(
    `SELECT
       c.id, c.contract_number, c.org_type, c.org_name, c.buyer_designation,
       c.total_value, c.bid_number, c.department, c.office_zone,
       c.status_of_the_contract, c.order_id, c.contract_pdf_url,
       c.products, c.full_html, c.buyer_company, c.seller_company,
       c.contract_date, c.created_at, c.updated_at, m.name AS ministry_name
     FROM contracts c
     LEFT JOIN contract_ministry m ON m.id = c.ministry_id
     ${where}
     ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  const data = rows.map((r) => {
    const enriched = enrichContract(r);
    delete enriched.full_html;
    return enriched;
  });

  return res.status(200).json({ data, total: countRes.rows[0].total, page, limit });
};

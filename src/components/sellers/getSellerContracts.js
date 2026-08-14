const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { enrichContract } = require('@/lib/contractHelpers');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.contractsMaxLimit).default(5),
    q: Schema.search(),
    ministry_id: Schema.uuid().allow(''),
    status: Joi.string().trim().max(100).allow(''),
    from: Schema.dateOnly().allow(''),
    to: Schema.dateOnly().allow(''),
    bid_number_null: Joi.boolean().optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 5;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const status = req.customQuery.status || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';
  const bidNumberNull =
    req.customQuery.bid_number_null === true || req.customQuery.bid_number_null === 'true';

  const sellerRes = await db.query(
    `SELECT id, seller_id, company_name, gst_number, contract_id
     FROM sellers
     WHERE id = $1`,
    [req.params.id]
  );
  if (!sellerRes.rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const seller = sellerRes.rows[0];
  const sellerIdVal = (seller.seller_id || '').trim();
  const gstNumberVal = (seller.gst_number || '').trim();

  // Indexed UNION of matching contract ids (avoids OR seq-scan on contracts)
  const idCte = `
    WITH matched AS (
      SELECT c.id
      FROM contracts c
      WHERE $2::text <> '' AND c.seller_id = $2
      UNION
      SELECT s.contract_id AS id
      FROM sellers s
      WHERE s.id = $1::uuid OR ($3::text <> '' AND s.gst_number = $3)
    )
  `;

  const filterParams = [seller.id, sellerIdVal, gstNumberVal];
  const clauses = ['c.id IN (SELECT id FROM matched)'];

  if (q) {
    filterParams.push(`%${q}%`);
    clauses.push(`(
      c.contract_number ILIKE $${filterParams.length} OR
      c.seller_id ILIKE $${filterParams.length} OR
      c.org_name ILIKE $${filterParams.length} OR
      c.bid_number ILIKE $${filterParams.length} OR
      c.department ILIKE $${filterParams.length} OR
      c.status_of_the_contract ILIKE $${filterParams.length} OR
      m.name ILIKE $${filterParams.length}
    )`);
  }

  if (ministryId) {
    filterParams.push(ministryId);
    clauses.push(`c.ministry_id = $${filterParams.length}`);
  }

  if (status) {
    filterParams.push(status);
    clauses.push(`c.status_of_the_contract = $${filterParams.length}`);
  }

  if (from) {
    filterParams.push(from);
    clauses.push(`c.contract_date >= $${filterParams.length}::date`);
  }

  if (to) {
    filterParams.push(to);
    clauses.push(`c.contract_date <= $${filterParams.length}::date`);
  }

  if (bidNumberNull) {
    clauses.push('contract_bid_number_missing(c.bid_number)');
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;
  const needsMinistryJoin = Boolean(q);
  const dataParams = [...filterParams, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      `${idCte}
       SELECT
         COUNT(c.id)::int AS total,
         COALESCE(SUM(c.total_value), 0)::numeric AS total_value
       FROM contracts c
       ${needsMinistryJoin ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : ''}
       ${whereClause}`,
      filterParams
    ),
    db.query(
      `${idCte},
       page AS (
         SELECT c.id
         FROM contracts c
         ${needsMinistryJoin ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : ''}
         ${whereClause}
         ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}
       )
       SELECT
         c.id, c.contract_number, c.org_type, c.org_name, c.buyer_designation,
         c.total_value, c.bid_number, c.department, c.office_zone,
         c.status_of_the_contract, c.order_id, c.contract_pdf_url,
         c.products, c.buyer_company, c.seller_company, c.seller_id,
         c.contract_date, c.created_at, c.updated_at, m.name AS ministry_name
       FROM page p
       JOIN contracts c ON c.id = p.id
       LEFT JOIN contract_ministry m ON m.id = c.ministry_id
       ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC`,
      dataParams
    ),
  ]);

  const total = countRes.rows[0]?.total || 0;
  const totalValue = parseFloat(countRes.rows[0]?.total_value) || 0;
  const data = rowsRes.rows.map((r) => enrichContract(r));

  return res.status(200).json({
    seller_id: seller.seller_id,
    company_name: seller.company_name,
    total,
    total_value: totalValue,
    page,
    limit,
    data,
  });
};

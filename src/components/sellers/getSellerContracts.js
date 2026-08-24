const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { enrichContract } = require('@/lib/contractHelpers');
const { normalizeBuyingMode } = require('@/lib/contractLookups');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');

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
    state_id: Schema.uuid().allow(''),
    from: Schema.dateOnly().allow(''),
    to: Schema.dateOnly().allow(''),
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
    bid_number_null: Joi.boolean().optional(),
    ministry: Joi.string().trim().max(200).allow(''),
    org_name: Joi.string().trim().max(200).allow(''),
    department: Joi.string().trim().max(200).allow(''),
    organization_type: Joi.string().trim().max(200).allow(''),
    buying_mode: Joi.string().trim().max(200).allow(''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 5;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const status = req.customQuery.status || '';
  const stateId = req.customQuery.state_id || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';
  const valueRangeKey = req.customQuery.value_range || '';
  const valueRange = getValueRange(valueRangeKey);
  const bidNumberNull = req.customQuery.bid_number_null;
  const ministryName = req.customQuery.ministry || '';
  const orgName = req.customQuery.org_name || '';
  const department = req.customQuery.department || '';
  const organizationType = req.customQuery.organization_type || '';
  const buyingMode = normalizeBuyingMode(req.customQuery.buying_mode || '') || '';

  const sellerRes = await db.query(
    `SELECT id, seller_id, company_name, COALESCE(total_value, 0) AS total_value,
            COALESCE(total_contracts, 0)::int AS total_contracts
     FROM new_seller_details
     WHERE id = $1`,
    [req.params.id]
  );
  if (!sellerRes.rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  if (req.user && req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const seller = sellerRes.rows[0];
  const params = [seller.id];
  const clauses = ['c.seller_id = $1'];

  const addExact = (column) => (value) => {
    if (!value) return;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  };

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      c.contract_number ILIKE $${params.length} OR
      c.org_name ILIKE $${params.length} OR
      c.department ILIKE $${params.length} OR
      c.office_zone ILIKE $${params.length} OR
      c.status_of_the_contract ILIKE $${params.length} OR
      c.order_id ILIKE $${params.length} OR
      c.bid_number ILIKE $${params.length} OR
      c.org_type ILIKE $${params.length} OR
      sd.seller_id ILIKE $${params.length} OR
      sd.company_name ILIKE $${params.length} OR
      bd.company_name ILIKE $${params.length} OR
      m.name ILIKE $${params.length}
    )`);
  }

  if (ministryId) {
    params.push(ministryId);
    clauses.push(`c.ministry_id = $${params.length}`);
  }

  if (ministryName) {
    params.push(ministryName);
    clauses.push(`c.ministry_id = (SELECT id FROM contract_ministry WHERE name = $${params.length} LIMIT 1)`);
  }

  if (stateId) {
    params.push(stateId);
    clauses.push(`c.state_id = $${params.length}`);
  }

  addExact('c.org_name')(orgName);
  addExact('c.department')(department);
  addExact('c.org_type')(organizationType);
  if (buyingMode) {
    params.push(buyingMode);
    clauses.push(`normalize_buying_mode(c.buying_mode) = $${params.length}`);
  }

  if (status) {
    params.push(status);
    clauses.push(`c.status_of_the_contract = $${params.length}`);
  }

  if (from) {
    params.push(from);
    clauses.push(`c.contract_date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    clauses.push(`c.contract_date <= $${params.length}::date`);
  }

  if (valueRange) {
    const rangeSql = valueRangeSql(valueRange, params);
    if (rangeSql) clauses.push(rangeSql);
  }

  if (bidNumberNull === true || bidNumberNull === 'true') {
    clauses.push('contract_bid_number_present(c.bid_number)');
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;
  const extraJoins = `
    JOIN new_seller_details sd ON sd.id = c.seller_id
    JOIN new_buyer_details bd ON bd.id = c.buyer_id
    LEFT JOIN contract_ministry m ON m.id = c.ministry_id
  `;
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(
      `SELECT
         COUNT(c.id)::int AS total,
         COALESCE(SUM(c.total_value), 0)::numeric AS total_value
       FROM new_contracts c
       ${extraJoins}
       ${whereClause}`,
      params
    ),
    db.query(
      `WITH page AS (
         SELECT c.id
         FROM new_contracts c
         ${extraJoins}
         ${whereClause}
         ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}
       )
       SELECT
         c.id, c.contract_number, c.org_type, c.org_name, c.total_value,
         c.department, c.office_zone, c.status_of_the_contract, c.order_id,
         c.contract_pdf_url, c.products, c.contract_date, c.created_at,
         c.bid_number, c.buyer_designation, c.buying_mode,
         sd.company_name AS seller_company,
         sd.seller_id,
         bd.company_name AS buyer_company,
         m.name AS ministry_name
       FROM page p
       JOIN new_contracts c ON c.id = p.id
       JOIN new_seller_details sd ON sd.id = c.seller_id
       JOIN new_buyer_details bd ON bd.id = c.buyer_id
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

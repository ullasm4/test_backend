const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { enrichContract } = require('@/lib/contractHelpers');
const { normalizeBuyingMode } = require('@/lib/contractLookups');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');

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
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
    bid_number_null: Joi.boolean().optional(),
    ministry: Joi.string().trim().max(200).allow(''),
    org_name: Joi.string().trim().max(200).allow(''),
    department: Joi.string().trim().max(200).allow(''),
    organization_type: Joi.string().trim().max(200).allow(''),
    buying_mode: Joi.string().trim().max(200).allow(''),
  }),
};

function sortClauses(sort) {
  const key = (sort || '').toLowerCase().trim();
  if (key === 'high_to_low' || key === 'value_desc') {
    return {
      page: 'c.total_value DESC NULLS LAST, c.created_at DESC',
      final: 'c.total_value DESC NULLS LAST, c.created_at DESC',
    };
  }
  if (key === 'low_to_high' || key === 'value_asc') {
    return {
      page: 'c.total_value ASC NULLS LAST, c.created_at DESC',
      final: 'c.total_value ASC NULLS LAST, c.created_at DESC',
    };
  }
  if (key === 'oldest' || key === 'date_asc') {
    return {
      page: 'c.contract_date ASC NULLS FIRST, c.created_at ASC',
      final: 'c.contract_date ASC NULLS FIRST, c.created_at ASC',
    };
  }
  return {
    page: 'c.contract_date DESC NULLS LAST, c.created_at DESC',
    final: 'c.contract_date DESC NULLS LAST, c.created_at DESC',
  };
}

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const status = req.customQuery.status || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';
  const valueRangeKey = req.customQuery.value_range || '';
  const valueRange = getValueRange(valueRangeKey);
  const ministryName = req.customQuery.ministry || '';
  const orgName = req.customQuery.org_name || '';
  const department = req.customQuery.department || '';
  const organizationType = req.customQuery.organization_type || '';
  const buyingMode = normalizeBuyingMode(req.customQuery.buying_mode || '') || '';
  const { page: pageOrder, final: finalOrder } = sortClauses(req.customQuery.sort);

  const params = [];
  const clauses = [];

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

  const bidPresent = req.customQuery.bid_number_null === true
    || req.customQuery.bid_number_null === 'true';
  if (bidPresent) {
    clauses.push('contract_bid_number_present(c.bid_number)');
  }

  const rangeClause = valueRangeSql(valueRange, params, 'c.total_value');
  if (rangeClause) {
    if (valueRange?.gt == null) {
      clauses.push(`c.total_value IS NOT NULL AND ${rangeClause}`);
    } else {
      clauses.push(rangeClause);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const nameJoins = [
    q ? 'JOIN new_seller_details sd ON sd.id = c.seller_id' : '',
    q ? 'JOIN new_buyer_details bd ON bd.id = c.buyer_id' : '',
    q ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : '',
  ].filter(Boolean).join('\n    ');
  const listJoins = nameJoins ? `\n    ${nameJoins}\n  ` : '';
  const extraFilters = Boolean(
    q || ministryId || status || from || to || valueRange
    || ministryName || orgName || department || organizationType || buyingMode
  );
  const applyTextFilters = Boolean(ministryName || orgName || department || organizationType || buyingMode);
  const onlyApplyFilter = applyTextFilters && !q && !ministryId && !status && !from && !to && !valueRange && !bidPresent;

  const LOOKUP_COUNT = {
    ministry: ['contract_ministry', ministryName],
    org_name: ['organizations', orgName],
    department: ['departments', department],
    organization_type: ['organization_types', organizationType],
    buying_mode: ['buying_modes', buyingMode],
  };
  const singleLookup = Object.values(LOOKUP_COUNT).filter(([, value]) => value);

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql;
  let countParams = params;
  if (!where) {
    countSql = `SELECT COALESCE(new_contracts, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else if (bidPresent && !extraFilters) {
    countSql = `SELECT COALESCE(new_contracts_with_bid_number, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else if (onlyApplyFilter && singleLookup.length === 1) {
    const [table, value] = singleLookup[0];
    countSql = `SELECT COALESCE(total_contract, 0)::int AS total FROM ${table} WHERE name = $1`;
    countParams = [value];
  } else if (valueRange?.column && !q && !ministryId && !status && !from && !to && !bidPresent && !applyTextFilters) {
    countSql = `SELECT COALESCE(${valueRange.column}, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else {
    countSql = `SELECT COUNT(*)::int AS total
       FROM new_contracts c
       ${listJoins}
       ${where}`;
  }

  const dataSql = `
    WITH page AS (
      SELECT c.id
      FROM new_contracts c
      ${listJoins}
      ${where}
      ORDER BY ${pageOrder}
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
    ORDER BY ${finalOrder}
  `;

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  const data = rowsRes.rows.map((r) => enrichContract(r));

  return res.status(200).json({ data, total: countRes.rows[0]?.total || 0, page, limit });
};

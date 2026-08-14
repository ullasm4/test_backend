const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { enrichContract } = require('@/lib/contractHelpers');
const { VALUE_RANGE_KEYS, VALUE_RANGE_COLUMNS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');

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
  const bidNumberNull =
    req.customQuery.bid_number_null === true || req.customQuery.bid_number_null === 'true';
  const { page: pageOrder, final: finalOrder } = sortClauses(req.customQuery.sort);

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
    // Exact match — matches Combobox options and uses status index
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

  const rangeClause = valueRangeSql(valueRange, params, 'c.total_value');
  if (rangeClause) {
    if (valueRange?.gt == null) {
      clauses.push(`c.total_value IS NOT NULL AND ${rangeClause}`);
    } else {
      clauses.push(rangeClause);
    }
  }

  if (bidNumberNull) {
    clauses.push('contract_bid_number_missing(c.bid_number)');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const ministryOnly =
    Boolean(ministryId) && !q && !status && !from && !to && !valueRange && !bidNumberNull;
  const valueRangeOnly =
    Boolean(valueRange) && !q && !ministryId && !status && !from && !to && !bidNumberNull;
  const bidNumberNullOnly =
    Boolean(bidNumberNull) && !q && !ministryId && !status && !from && !to && !valueRange;
  const needsMinistryJoin = Boolean(q);

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql;
  let countParams = [];
  if (!where) {
    countSql = `SELECT COALESCE(total_contracts, 0)::int AS total FROM total_counts WHERE id = 1`;
  } else if (bidNumberNullOnly) {
    countSql = `SELECT COALESCE(contracts_bid_number_null, 0)::int AS total FROM total_counts WHERE id = 1`;
  } else if (valueRangeOnly && VALUE_RANGE_COLUMNS.has(valueRange.column)) {
    countSql = `SELECT COALESCE(${valueRange.column}, 0)::int AS total FROM total_counts WHERE id = 1`;
  } else if (ministryOnly) {
    countSql = `SELECT COALESCE(total_contract, 0)::int AS total FROM contract_ministry WHERE id = $1`;
    countParams = [ministryId];
  } else {
    countSql = `SELECT COUNT(c.id)::int AS total
       FROM contracts c
       ${needsMinistryJoin ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : ''}
       ${where}`;
    countParams = params;
  }

  // Page ids via sort index first, then fetch row details (avoids sorting wide rows)
  const dataSql = `
    WITH page AS (
      SELECT c.id
      FROM contracts c
      ${needsMinistryJoin ? 'LEFT JOIN contract_ministry m ON m.id = c.ministry_id' : ''}
      ${where}
      ORDER BY ${pageOrder}
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
    ORDER BY ${finalOrder}
  `;

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  const data = rowsRes.rows.map((r) => enrichContract(r));

  return res.status(200).json({ data, total: countRes.rows[0]?.total || 0, page, limit });
};

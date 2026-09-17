const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { enrichContract } = require('@/lib/contractHelpers');
const { normalizeBuyingMode } = require('@/lib/contractLookups');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.contractsMaxLimit).default(10),
    q: Schema.search(),
    ministry_id: Schema.uuid().allow(''),
    status: Joi.string().trim().max(100).allow(''),
    state_id: Schema.uuid().allow(''),
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
    is_service: Joi.boolean().optional(),
  }),
};

function sortClauses(sort) {
  const key = (sort || '').toLowerCase().trim();
  if (key === 'high_to_low' || key === 'value_desc') {
    return {
      page: 'c.total_value DESC NULLS LAST, c.created_at DESC',
      final: 'c.total_value DESC NULLS LAST, c.created_at DESC',
      scoped: 'total_value DESC NULLS LAST, created_at DESC',
    };
  }
  if (key === 'low_to_high' || key === 'value_asc') {
    return {
      page: 'c.total_value ASC NULLS LAST, c.created_at DESC',
      final: 'c.total_value ASC NULLS LAST, c.created_at DESC',
      scoped: 'total_value ASC NULLS LAST, created_at DESC',
    };
  }
  if (key === 'oldest' || key === 'date_asc') {
    return {
      page: 'c.contract_date ASC NULLS FIRST, c.created_at ASC',
      final: 'c.contract_date ASC NULLS FIRST, c.created_at ASC',
      scoped: 'contract_date ASC NULLS FIRST, created_at ASC',
    };
  }
  return {
    page: 'c.contract_date DESC NULLS LAST, c.created_at DESC',
    final: 'c.contract_date DESC NULLS LAST, c.created_at DESC',
    scoped: 'contract_date DESC NULLS LAST, created_at DESC',
  };
}

function buildFilterState(req) {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const ministryId = req.customQuery.ministry_id || '';
  const status = req.customQuery.status || '';
  const stateId = req.customQuery.state_id || '';
  const from = req.customQuery.from || '';
  const to = req.customQuery.to || '';
  const valueRangeKey = req.customQuery.value_range || '';
  const valueRange = getValueRange(valueRangeKey);
  const ministryName = req.customQuery.ministry || '';
  const orgName = req.customQuery.org_name || '';
  const department = req.customQuery.department || '';
  const organizationType = req.customQuery.organization_type || '';
  const buyingMode = normalizeBuyingMode(req.customQuery.buying_mode || '') || '';
  const isService = req.user?.role === 'admin' ? req.customQuery.is_service : undefined;
  const bidPresent =
    req.customQuery.bid_number_null === true || req.customQuery.bid_number_null === 'true';
  const sort = sortClauses(req.customQuery.sort);

  return {
    page,
    limit,
    offset,
    q,
    ministryId,
    status,
    stateId,
    from,
    to,
    valueRange,
    ministryName,
    orgName,
    department,
    organizationType,
    buyingMode,
    isService,
    bidPresent,
    sort,
  };
}

/**
 * Contract-number searches must not ILIKE every column. On ~7M rows that plan
 * scans new_contracts in date order and takes minutes. Use the btree index instead.
 *   15+ digits (with or without GEMC-) → equality
 *   shorter digit run                   → prefix GEMC-{digits}%
 */
function contractNumberSearch(q) {
  const compact = String(q || '').replace(/\s+/g, '').toUpperCase();
  const m = compact.match(/^(?:GEMC-)?(\d{6,})$/);
  if (!m) return null;
  const digits = m[1];
  const prefixed = `GEMC-${digits}`;
  if (digits.length >= 15) {
    return { exact: [...new Set([prefixed, compact, digits])] };
  }
  return { prefix: `${prefixed}%` };
}

/**
 * Text search (product name, ministry, seller, …) as separate index lookups.
 * One OR across joins makes Postgres scan every contract and the request never returns.
 */
function textHitsSql(paramRef) {
  const columns = [
    'contract_number',
    'org_name',
    'department',
    'office_zone',
    'status_of_the_contract',
    'order_id',
    'bid_number',
    'org_type',
  ];
  const branches = columns.map(
    (col) => `SELECT id FROM new_contracts WHERE ${col} ILIKE ${paramRef}`
  );
  branches.push(
    `SELECT id FROM new_contracts WHERE contract_product_names(products) ILIKE ${paramRef}`
  );
  branches.push(
    `SELECT c.id
       FROM new_contracts c
       JOIN new_seller_details sd ON sd.id = c.seller_id
      WHERE sd.seller_id ILIKE ${paramRef}`
  );
  branches.push(
    `SELECT c.id
       FROM new_contracts c
       JOIN new_seller_details sd ON sd.id = c.seller_id
      WHERE sd.company_name ILIKE ${paramRef}`
  );
  branches.push(
    `SELECT c.id
       FROM new_contracts c
       JOIN new_buyer_details bd ON bd.id = c.buyer_id
      WHERE bd.company_name ILIKE ${paramRef}`
  );
  branches.push(
    `SELECT c.id
       FROM new_contracts c
       JOIN contract_ministry m ON m.id = c.ministry_id
      WHERE m.name ILIKE ${paramRef}`
  );
  return branches.join('\n    UNION\n    ');
}

function textHitsCte(f) {
  if (!f.textParam) return '';
  return `text_hits AS (\n    ${textHitsSql(`$${f.textParam}`)}\n  ),`;
}

function textHitsJoin(f) {
  return f.textParam ? 'JOIN text_hits h ON h.id = c.id' : '';
}

function pushFilters(params, clauses, f) {
  const addExact = (column) => (value) => {
    if (!value) return;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  };

  if (f.q) {
    const cn = contractNumberSearch(f.q);
    if (cn?.exact) {
      params.push(cn.exact);
      clauses.push(`c.contract_number = ANY($${params.length}::text[])`);
    } else if (cn?.prefix) {
      params.push(cn.prefix);
      clauses.push(`c.contract_number LIKE $${params.length}`);
    } else {
      params.push(`%${String(f.q).trim()}%`);
      f.textParam = params.length;
    }
  }

  if (f.ministryId) {
    params.push(f.ministryId);
    clauses.push(`c.ministry_id = $${params.length}`);
  }

  if (f.ministryName) {
    params.push(f.ministryName);
    clauses.push(
      `c.ministry_id = (SELECT id FROM contract_ministry WHERE name = $${params.length} LIMIT 1)`
    );
  }

  if (f.stateId) {
    params.push(f.stateId);
    clauses.push(`c.state_id = $${params.length}`);
  }

  addExact('c.org_name')(f.orgName);
  addExact('c.department')(f.department);
  addExact('c.org_type')(f.organizationType);
  if (f.buyingMode) {
    params.push(f.buyingMode);
    clauses.push(`normalize_buying_mode(c.buying_mode) = $${params.length}`);
  }

  if (f.status) {
    params.push(f.status);
    clauses.push(`c.status_of_the_contract = $${params.length}`);
  }

  if (f.from) {
    params.push(f.from);
    clauses.push(`c.contract_date >= $${params.length}::date`);
  }

  if (f.to) {
    params.push(f.to);
    clauses.push(`c.contract_date <= $${params.length}::date`);
  }

  if (f.bidPresent) {
    clauses.push('contract_bid_number_present(c.bid_number)');
  }

  if (f.isService === true || f.isService === 'true') {
    clauses.push('c.is_service = TRUE');
  } else if (f.isService === false || f.isService === 'false') {
    clauses.push('(c.is_service = FALSE OR c.is_service IS NULL)');
  }

  const rangeClause = valueRangeSql(f.valueRange, params, 'c.total_value');
  if (rangeClause) {
    if (f.valueRange?.gt == null) {
      clauses.push(`c.total_value IS NOT NULL AND ${rangeClause}`);
    } else {
      clauses.push(rangeClause);
    }
  }
}


async function listForEndUser(req, res, db, f) {
  const params = [req.user.id];
  const clauses = [];
  pushFilters(params, clauses, f);
  const whereExtra = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

  // Drive from assignment tables + seller/buyer indexes on new_contracts
  // instead of EXISTS over the full contracts table.
  const scopedCte = `
    WITH ${textHitsCte(f)} scoped AS (
      SELECT c.id, c.contract_date, c.created_at, c.total_value
      FROM seller_end_users seu
      JOIN new_contracts c ON c.seller_id = seu.seller_id
      ${textHitsJoin(f)}
      WHERE seu.end_user_id = $1
      ${whereExtra}
      UNION
      SELECT c.id, c.contract_date, c.created_at, c.total_value
      FROM buyer_end_users beu
      JOIN new_contracts c ON c.buyer_id = beu.buyer_id
      ${textHitsJoin(f)}
      WHERE beu.end_user_id = $1
      ${whereExtra}
    )
  `;

  const dataParams = [...params, f.limit, f.offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const countSql = `
    ${scopedCte}
    SELECT COUNT(*)::int AS total FROM scoped
  `;

  const dataSql = `
    ${scopedCte},
    page AS (
      SELECT id
      FROM scoped
      ORDER BY ${f.sort.scoped}
      LIMIT $${limIdx} OFFSET $${offIdx}
    )
    SELECT
      c.id, c.contract_number, c.org_type, c.org_name, c.total_value,
      c.department, c.office_zone, c.status_of_the_contract,
      c.contract_pdf_url, c.products, c.contract_date, c.created_at,
      c.bid_number, c.buyer_designation, c.buying_mode, c.is_service, c.state_id,
      sd.company_name AS seller_company,
      sd.seller_id,
      bd.company_name AS buyer_company,
      m.name AS ministry_name,
      st.name AS state_name
    FROM page p
    JOIN new_contracts c ON c.id = p.id
    LEFT JOIN new_seller_details sd ON sd.id = c.seller_id
    LEFT JOIN new_buyer_details bd ON bd.id = c.buyer_id
    LEFT JOIN contract_ministry m ON m.id = c.ministry_id
    LEFT JOIN states st ON st.id = c.state_id
    ORDER BY ${f.sort.final}
  `;

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({
    data: rowsRes.rows.map((r) => enrichContract(r)),
    total: countRes.rows[0]?.total || 0,
    page: f.page,
    limit: f.limit,
  });
}

exports.controller = async (req, res, _next, db) => {
  const f = buildFilterState(req);

  if (isEndUser(req.user)) {
    return listForEndUser(req, res, db, f);
  }

  const params = [];
  const clauses = [];

  const isUserRole = req.user && req.user.role !== 'admin';
  if (isUserRole) {
    params.push(req.user.id);
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = c.seller_id AND uas.user_id = $${params.length}
    )`);
  }

  pushFilters(params, clauses, f);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const extraFilters = Boolean(
    f.q ||
      f.ministryId ||
      f.status ||
      f.stateId ||
      f.from ||
      f.to ||
      f.valueRange ||
      f.ministryName ||
      f.orgName ||
      f.department ||
      f.organizationType ||
      f.buyingMode ||
      f.isService === true ||
      f.isService === 'true' ||
      f.isService === false ||
      f.isService === 'false'
  );
  const applyTextFilters = Boolean(
    f.ministryName || f.orgName || f.department || f.organizationType || f.buyingMode
  );
  const onlyApplyFilter =
    applyTextFilters &&
    !f.q &&
    !f.ministryId &&
    !f.status &&
    !f.stateId &&
    !f.from &&
    !f.to &&
    !f.valueRange &&
    !f.bidPresent;

  const LOOKUP_COUNT = {
    ministry: ['contract_ministry', f.ministryName],
    org_name: ['organizations', f.orgName],
    department: ['departments', f.department],
    organization_type: ['organization_types', f.organizationType],
    buying_mode: ['buying_modes', f.buyingMode],
  };
  const singleLookup = Object.values(LOOKUP_COUNT).filter(([, value]) => value);

  const dataParams = [...params, f.limit, f.offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql;
  let countParams = params;
  if (!where && !f.textParam && !isUserRole) {
    countSql = `SELECT COALESCE(new_contracts, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else if (f.bidPresent && !extraFilters && !isUserRole) {
    countSql = `SELECT COALESCE(new_contracts_with_bid_number, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else if (onlyApplyFilter && singleLookup.length === 1 && !isUserRole) {
    const [table, value] = singleLookup[0];
    countSql = `SELECT COALESCE(total_contract, 0)::int AS total FROM ${table} WHERE name = $1`;
    countParams = [value];
  } else if (
    f.valueRange?.column &&
    !f.q &&
    !f.ministryId &&
    !f.status &&
    !f.stateId &&
    !f.from &&
    !f.to &&
    !f.bidPresent &&
    !applyTextFilters &&
    !isUserRole
  ) {
    countSql = `SELECT COALESCE(${f.valueRange.column}, 0)::int AS total FROM total_counts WHERE id = 1`;
    countParams = [];
  } else {
    countSql = `WITH ${textHitsCte(f)} counted AS (
         SELECT 1
           FROM new_contracts c
           ${textHitsJoin(f)}
           ${where}
       )
       SELECT COUNT(*)::int AS total FROM counted`;
  }

  const dataSql = `
    WITH ${textHitsCte(f)} page AS (
      SELECT c.id
      FROM new_contracts c
      ${textHitsJoin(f)}
      ${where}
      ORDER BY ${f.sort.page}
      LIMIT $${limIdx} OFFSET $${offIdx}
    )
    SELECT
      c.id, c.contract_number, c.org_type, c.org_name, c.total_value,
      c.department, c.office_zone, c.status_of_the_contract,
      c.contract_pdf_url, c.products, c.contract_date, c.created_at,
      c.bid_number, c.buyer_designation, c.buying_mode, c.is_service, c.state_id,
      sd.company_name AS seller_company,
      sd.seller_id,
      bd.company_name AS buyer_company,
      m.name AS ministry_name,
      st.name AS state_name
    FROM page p
    JOIN new_contracts c ON c.id = p.id
    LEFT JOIN new_seller_details sd ON sd.id = c.seller_id
    LEFT JOIN new_buyer_details bd ON bd.id = c.buyer_id
    LEFT JOIN contract_ministry m ON m.id = c.ministry_id
    LEFT JOIN states st ON st.id = c.state_id
    ORDER BY ${f.sort.final}
  `;

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({
    data: rowsRes.rows.map((r) => enrichContract(r)),
    total: countRes.rows[0]?.total || 0,
    page: f.page,
    limit: f.limit,
  });
};

const { getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');
const { HAS_PHONE_SQL, HAS_EMAIL_SQL } = require('@/lib/newTableSql');
const { parseUuidList } = require('@/lib/parseUuidList');
const { GST_TYPES } = require('@/config/gstType');

const stateCache = new Map();

function truthy(v) {
  return v === true || v === 'true';
}

function parseStringList(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
  } else if (typeof raw === 'string' && raw.trim()) {
    list = raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return Array.from(new Set(list));
}

/**
 * Append Sellers-list style filters onto `clauses` / `params` for `new_seller_details sd`.
 * Does not apply role-based assignment scopes (caller handles admin vs assigned user).
 */
async function appendSellerListFilters(db, filters = {}, params, clauses, options = {}) {
  const { includeAssignmentFilters = true } = options;

  const q = String(filters.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      sd.company_name ILIKE $${params.length} OR
      sd.seller_id ILIKE $${params.length} OR
      EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND (
          x.email ILIKE $${params.length} OR
          x.phone ILIKE $${params.length} OR
          x.gst_number ILIKE $${params.length}
        )
      )
    )`);
  }

  const stateVal = String(filters.state || '').trim();
  if (stateVal) {
    let stateCode = '';
    const match = stateVal.match(/\b\d{2}\b/) || stateVal.match(/\d{2}/);
    if (match) {
      stateCode = match[0];
    } else {
      const cacheKey = stateVal.toLowerCase();
      if (stateCache.has(cacheKey)) {
        stateCode = stateCache.get(cacheKey);
      } else {
        const stateRes = await db.query(
          `SELECT gst_code FROM states WHERE LOWER(name) ILIKE LOWER($1) OR name ILIKE $2 LIMIT 1`,
          [stateVal, `%${stateVal}%`]
        );
        if (stateRes.rows[0]?.gst_code) {
          stateCode = stateRes.rows[0].gst_code;
          stateCache.set(cacheKey, stateCode);
        }
      }
    }
    if (stateCode) {
      params.push(`${stateCode.trim()}%`);
      clauses.push(`EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND x.gst_number LIKE $${params.length}
      )`);
    }
  }

  const cityIds = parseUuidList(filters.city_id);
  if (cityIds.length) {
    params.push(cityIds);
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id
        AND x.city_id = ANY($${params.length}::uuid[])
    )`);
  }

  const listingType = String(filters.type || '').trim();
  if (listingType) {
    params.push(listingType);
    clauses.push(`sd.type = $${params.length}::public.listing_type`);
  }

  const statusFilter = String(filters.status || '').trim();
  if (statusFilter) {
    params.push(statusFilter);
    clauses.push(`COALESCE(sd.status, 'new') = $${params.length}`);
  }

  const categoryList = parseStringList(
    filters.category || filters['category[]'] || filters.categories || filters['categories[]']
  );
  if (categoryList.length) {
    params.push(categoryList);
    clauses.push(`EXISTS (
      SELECT 1 FROM seller_category sc
      WHERE sc.category = ANY($${params.length})
        AND (sc.seller_id = sd.id::text OR sc.seller_id = sd.seller_id)
    )`);
  }

  const gstTypeList = Array.from(
    new Set(
      parseStringList(filters.gst_type || filters['gst_type[]'])
        .map((code) => code.toUpperCase())
        .filter((code) => GST_TYPES.includes(code))
    )
  );
  if (gstTypeList.length) {
    params.push(gstTypeList);
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id
        AND x.gst_number IS NOT NULL
        AND BTRIM(x.gst_number) <> ''
        AND LENGTH(BTRIM(x.gst_number)) >= 4
        AND UPPER(SUBSTRING(BTRIM(x.gst_number) FROM 4 FOR 1)) = ANY($${params.length})
    )`);
  }

  const hasPhone = truthy(filters.has_phone);
  const hasEmail = truthy(filters.has_email);
  const uniquePhone = truthy(filters.unique_phone);
  const uniqueEmail = truthy(filters.unique_email);
  const uniqueGst = truthy(filters.unique_gst);
  const remainingWhatsApp = truthy(filters.remaining_whatsapp);
  const remainingEmail = truthy(filters.remaining_email);

  if (hasPhone || uniquePhone || remainingWhatsApp) clauses.push(HAS_PHONE_SQL);
  if (hasEmail || uniqueEmail || remainingEmail) clauses.push(HAS_EMAIL_SQL);
  if (remainingWhatsApp) clauses.push('sd.whatsapp_sent IS NOT TRUE');
  if (remainingEmail) clauses.push('sd.email_sent IS NOT TRUE');
  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id AND x.gst_number IS NOT NULL AND BTRIM(x.gst_number) <> ''
    )`);
  }

  if (includeAssignmentFilters) {
    const assignedUserId = String(filters.assigned_user_id || '').trim();
    const assigned = truthy(filters.assigned);
    const unassigned = truthy(filters.unassigned);
    if (assignedUserId) {
      params.push(assignedUserId);
      clauses.push(`EXISTS (
        SELECT 1 FROM user_assign_sellers uas
        WHERE uas.seller_id = sd.id AND uas.user_id = $${params.length}
      )`);
    } else if (unassigned) {
      clauses.push(`NOT EXISTS (
        SELECT 1 FROM user_assign_sellers uas
        WHERE uas.seller_id = sd.id
      )`);
    } else if (assigned) {
      clauses.push(`EXISTS (
        SELECT 1 FROM user_assign_sellers uas
        WHERE uas.seller_id = sd.id
      )`);
    }
  }

  const valueRange = getValueRange(filters.value_range || '');
  if (valueRange) {
    const rangeClause = valueRangeSql(valueRange, params, 'COALESCE(sd.total_value, 0)');
    if (rangeClause) clauses.push(rangeClause);
  } else if (filters.value_amount !== undefined && filters.value_amount !== null && filters.value_amount !== '') {
    const valAmt = Number(filters.value_amount);
    if (!Number.isNaN(valAmt)) {
      params.push(valAmt);
      const valueOp = String(filters.value_op || 'gte').toLowerCase();
      if (valueOp === 'lte' || valueOp === 'less_than' || valueOp === '<') {
        clauses.push(`COALESCE(sd.total_value, 0) <= $${params.length}`);
      } else if (valueOp === 'eq' || valueOp === 'equal' || valueOp === '=') {
        clauses.push(`COALESCE(sd.total_value, 0) = $${params.length}`);
      } else {
        clauses.push(`COALESCE(sd.total_value, 0) >= $${params.length}`);
      }
    }
  }

  // Whitelist only — never interpolate raw user sort strings into SQL.
  const sortKey = String(filters.sort_value || filters.sort || '').toLowerCase().trim();
  const ORDER_BY = {
    high_to_low: 'total_value DESC, company_name ASC NULLS LAST, seller_uuid ASC',
    desc: 'total_value DESC, company_name ASC NULLS LAST, seller_uuid ASC',
    low_to_high: 'total_value ASC, company_name ASC NULLS LAST, seller_uuid ASC',
    asc: 'total_value ASC, company_name ASC NULLS LAST, seller_uuid ASC',
  };
  const orderBy = ORDER_BY[sortKey] || 'seller_uuid ASC';

  return { orderBy };
}

module.exports = { appendSellerListFilters };

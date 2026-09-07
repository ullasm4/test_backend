const { getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');
const { HAS_PHONE_SQL, HAS_EMAIL_SQL } = require('@/lib/newTableSql');

const stateCache = new Map();

function truthy(v) {
  return v === true || v === 'true';
}

/**
 * Build WHERE clauses for new_seller_details (alias sd) used by assign-by-filter.
 * Restricts to sellers not yet assigned to this end user (shared across end users is allowed).
 */
async function buildSellerAssignFilters(db, filters = {}, endUserId) {
  const params = [];
  const clauses = [];

  params.push(endUserId);
  clauses.push(`NOT EXISTS (
    SELECT 1 FROM seller_end_users seu
    WHERE seu.seller_id = sd.id AND seu.end_user_id = $${params.length}
  )`);

  const q = (filters.q || '').trim();
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

  const stateVal = (filters.state || '').trim();
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

  const listingType = (filters.type || '').trim();
  if (listingType) {
    params.push(listingType);
    clauses.push(`sd.type = $${params.length}::public.listing_type`);
  }

  const hasPhone = truthy(filters.has_phone);
  const hasEmail = truthy(filters.has_email);
  const uniquePhone = truthy(filters.unique_phone);
  const uniqueEmail = truthy(filters.unique_email);
  const uniqueGst = truthy(filters.unique_gst);

  if (hasPhone || uniquePhone) clauses.push(HAS_PHONE_SQL);
  if (hasEmail || uniqueEmail) clauses.push(HAS_EMAIL_SQL);
  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id AND x.gst_number IS NOT NULL AND BTRIM(x.gst_number) <> ''
    )`);
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

  const sortKey = String(filters.sort_value || '').toLowerCase().trim();
  let orderBy = 'COALESCE(sd.total_value, 0) DESC, sd.company_name ASC NULLS LAST, sd.id ASC';
  if (sortKey === 'low_to_high' || sortKey === 'asc') {
    orderBy = 'COALESCE(sd.total_value, 0) ASC, sd.company_name ASC NULLS LAST, sd.id ASC';
  }

  return { params, clauses, orderBy };
}

module.exports = { buildSellerAssignFilters };

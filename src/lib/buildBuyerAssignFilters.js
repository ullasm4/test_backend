const { getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');

const stateCache = new Map();

function truthy(v) {
  return v === true || v === 'true';
}

/**
 * Build WHERE clauses for new_buyer_details (alias b) used by assign-by-filter.
 * Restricts to buyers not yet assigned to this end user (shared across end users is allowed).
 */
async function buildBuyerAssignFilters(db, filters = {}, endUserId) {
  const params = [];
  const clauses = [];

  params.push(endUserId);
  clauses.push(`NOT EXISTS (
    SELECT 1 FROM buyer_end_users beu
    WHERE beu.buyer_id = b.id AND beu.end_user_id = $${params.length}
  )`);

  const q = (filters.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      b.company_name ILIKE $${params.length} OR
      b.email ILIKE $${params.length} OR
      b.phone ILIKE $${params.length} OR
      b.gst_number ILIKE $${params.length}
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
      clauses.push(`b.gst_number LIKE $${params.length}`);
    }
  }

  const hasPhone = truthy(filters.has_phone);
  const hasEmail = truthy(filters.has_email);
  const uniquePhone = truthy(filters.unique_phone);
  const uniqueEmail = truthy(filters.unique_email);
  const uniqueGst = truthy(filters.unique_gst);

  if (hasPhone || uniquePhone) {
    clauses.push(`b.phone IS NOT NULL AND BTRIM(b.phone) <> ''`);
  }
  if (hasEmail || uniqueEmail) {
    clauses.push(`b.email IS NOT NULL AND BTRIM(b.email) <> ''`);
  }
  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`b.gst_number IS NOT NULL AND BTRIM(b.gst_number) <> ''`);
  }

  const valueRange = getValueRange(filters.value_range || '');
  if (valueRange) {
    const rangeClause = valueRangeSql(valueRange, params, 'COALESCE(b.total_value, 0)');
    if (rangeClause) clauses.push(rangeClause);
  } else if (filters.value_amount !== undefined && filters.value_amount !== null && filters.value_amount !== '') {
    const valAmt = Number(filters.value_amount);
    if (!Number.isNaN(valAmt)) {
      params.push(valAmt);
      const valueOp = String(filters.value_op || 'gte').toLowerCase();
      if (valueOp === 'lte' || valueOp === 'less_than' || valueOp === '<') {
        clauses.push(`COALESCE(b.total_value, 0) <= $${params.length}`);
      } else if (valueOp === 'eq' || valueOp === 'equal' || valueOp === '=') {
        clauses.push(`COALESCE(b.total_value, 0) = $${params.length}`);
      } else {
        clauses.push(`COALESCE(b.total_value, 0) >= $${params.length}`);
      }
    }
  }

  const sortKey = String(filters.sort_value || '').toLowerCase().trim();
  let orderBy = 'COALESCE(b.total_value, 0) DESC, b.company_name ASC NULLS LAST, b.id ASC';
  if (sortKey === 'low_to_high' || sortKey === 'asc') {
    orderBy = 'COALESCE(b.total_value, 0) ASC, b.company_name ASC NULLS LAST, b.id ASC';
  }

  return { params, clauses, orderBy };
}

module.exports = { buildBuyerAssignFilters };

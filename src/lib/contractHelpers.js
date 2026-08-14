const { normalizeProducts, parseGemContractDate } = require('@/lib/htmlFields');

/** Normalize DB DATE / Date / GeM string → YYYY-MM-DD */
function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    return parseGemContractDate(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function enrichContract(row) {
  if (!row) return null;
  const products = normalizeProducts(row.products);
  const contractDate = toDateOnly(row.contract_date);

  return {
    ...row,
    products,
    buying_mode: row.buying_mode || null,
    // Always YYYY-MM-DD — same value used by from/to filters
    contract_date: contractDate,
    ministry: row.ministry_name || null,
  };
}

module.exports = { enrichContract, toDateOnly };

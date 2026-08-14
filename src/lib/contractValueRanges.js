const CONTRACT_VALUE_RANGES = [
  { key: '0_50k', label: '0 - 50,000', column: 'value_0_50k', gt: null, lte: 50000 },
  { key: '50k_5l', label: '50,000 - 5,00,000', column: 'value_50k_5l', gt: 50000, lte: 500000 },
  { key: '5l_10l', label: '5,00,000 - 10,00,000', column: 'value_5l_10l', gt: 500000, lte: 1000000 },
  { key: '10l_50l', label: '10,00,000 - 50,00,000', column: 'value_10l_50l', gt: 1000000, lte: 5000000 },
  { key: '50l_1cr', label: '50,00,000 - 1,00,00,000', column: 'value_50l_1cr', gt: 5000000, lte: 10000000 },
  { key: '1cr_5cr', label: '1,00,00,000 - 5,00,00,000', column: 'value_1cr_5cr', gt: 10000000, lte: 50000000 },
  { key: '5cr_10cr', label: '5,00,00,000 - 10,00,00,000', column: 'value_5cr_10cr', gt: 50000000, lte: 100000000 },
  { key: '10cr_50cr', label: '10,00,00,000 - 50,00,00,000', column: 'value_10cr_50cr', gt: 100000000, lte: 500000000 },
  { key: '50cr_plus', label: '50,00,00,000+', column: 'value_50cr_plus', gt: 500000000, lte: null },
];

function getValueRange(key) {
  if (!key) return null;
  return CONTRACT_VALUE_RANGES.find((r) => r.key === key) || null;
}

function valueRangeSql(range, params, valueExpr = 'c.total_value') {
  if (!range) return null;
  if (range.gt == null && range.lte != null) {
    params.push(range.lte);
    return `${valueExpr} <= $${params.length}`;
  }
  if (range.gt != null && range.lte != null) {
    params.push(range.gt);
    const gtIdx = params.length;
    params.push(range.lte);
    return `${valueExpr} > $${gtIdx} AND ${valueExpr} <= $${params.length}`;
  }
  if (range.gt != null && range.lte == null) {
    params.push(range.gt);
    return `${valueExpr} > $${params.length}`;
  }
  return null;
}

module.exports = {
  CONTRACT_VALUE_RANGES,
  VALUE_RANGE_KEYS: CONTRACT_VALUE_RANGES.map((r) => r.key),
  VALUE_RANGE_COLUMNS: new Set(CONTRACT_VALUE_RANGES.map((r) => r.column)),
  getValueRange,
  valueRangeSql,
};

/** Extract labeled values from GeM contract HTML: <strong>Label: </strong><span>value</span> */
function extractFromHtml(html, label) {
  if (!html) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<strong>\\s*${escaped}\\s*:\\s*</strong>\\s*<span[^>]*>\\s*([^<]+)`,
    'i'
  );
  const m = String(html).match(re);
  if (m?.[1]) return m[1].trim();

  const loose = new RegExp(`${escaped}\\s*:\\s*</?(?:strong|b)?[^>]*>\\s*<span[^>]*>\\s*([^<]+)`, 'i');
  const m2 = String(html).match(loose);
  return m2?.[1]?.trim() || null;
}

/** Parse GeM contract date strings like "25/5/2025 10:15" or "8/4/2025, 12:24:44 PM" → YYYY-MM-DD */
function parseGemContractDate(raw) {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(check.getTime())) return null;
  return iso;
}

function normalizeProducts(products) {
  if (Array.isArray(products)) return products;
  if (products && typeof products === 'object') {
    if (Array.isArray(products.items)) return products.items;
    return [];
  }
  return [];
}

module.exports = { extractFromHtml, normalizeProducts, parseGemContractDate };

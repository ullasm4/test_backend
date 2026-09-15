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

const MONTH_NAME_TO_NUM = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function toIsoDate(day, month, year) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(check.getTime())) return null;
  return iso;
}

/**
 * Parse GeM contract date strings → YYYY-MM-DD.
 * Supports listing HTML and PDF forms:
 *   25/5/2025 10:15 | 8/4/2025, 12:24:44 PM
 *   21-Sep-2023 | 21-09-2023 | 2023-09-21
 */
function parseGemContractDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // DD/MM/YYYY (listing HTML)
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD-MMM-YYYY (PDF Generated Date, e.g. 21-Sep-2023)
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (m) {
    const month = MONTH_NAME_TO_NUM[m[2].toLowerCase()];
    if (!month) return null;
    return toIsoDate(Number(m[1]), month, Number(m[3]));
  }

  // DD-MM-YYYY
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));

  return null;
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

/**
 * Parse a single UUID or comma-separated UUID list from query/body filters.
 * @param {unknown} value
 * @returns {string[]}
 */
function parseUuidList(value) {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  return [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))];
}

module.exports = { parseUuidList };

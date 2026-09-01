/**
 * Normalize Brevo / SMTP message IDs for storage and lookup.
 * Examples:
 *   <c9ba5af9-344f-a5f6-1a8b-228d018f8a42@pem.co.in> -> c9ba5af9-344f-a5f6-1a8b-228d018f8a42
 *   201798300811.5787683@relay.brevo.com -> 201798300811.5787683
 */
function normalizeMessageId(value) {
  let raw = String(value || '').trim();
  if (!raw) return null;

  raw = raw.replace(/^<|>$/g, '');

  const at = raw.indexOf('@');
  if (at > 0) {
    raw = raw.slice(0, at);
  }

  raw = raw.trim();
  return raw || null;
}

/**
 * SQL expression to normalize a message_id column/value for comparison
 * (handles legacy rows stored with brackets or @domain suffix).
 */
function messageIdMatchSql(columnExpr) {
  return `split_part(REPLACE(REPLACE(COALESCE(${columnExpr}, ''), '<', ''), '>', ''), '@', 1)`;
}

module.exports = {
  normalizeMessageId,
  messageIdMatchSql,
};

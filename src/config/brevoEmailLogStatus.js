/**
 * Brevo email log status filter values (normalized, no separators).
 * Match against seller_email_log.response_payload.last_webhook_event.event
 */
const BREVO_EMAIL_LOG_STATUSES = Object.freeze([
  { key: 'pending', label: 'Pending', match: ['pending'] },
  { key: 'request', label: 'Request', match: ['request'] },
  { key: 'sent', label: 'Sent', match: ['sent'] },
  { key: 'delivered', label: 'Delivered', match: ['delivered'] },
  { key: 'opened', label: 'Opened', match: ['opened', 'uniqueopened'] },
  { key: 'uniqueopened', label: 'Unique opened', match: ['uniqueopened'] },
  { key: 'click', label: 'Click / Link opened', match: ['click', 'clicked'] },
  { key: 'softbounce', label: 'Soft bounce', match: ['softbounce'] },
  { key: 'hardbounce', label: 'Hard bounce', match: ['hardbounce'] },
  { key: 'deferred', label: 'Deferred', match: ['deferred'] },
  { key: 'blocked', label: 'Blocked', match: ['blocked'] },
  { key: 'invalid', label: 'Invalid', match: ['invalid'] },
  { key: 'spam', label: 'Spam', match: ['spam'] },
  { key: 'unsubscribed', label: 'Unsubscribed', match: ['unsubscribed'] },
  { key: 'error', label: 'Error', match: ['error'] },
]);

const BREVO_EMAIL_LOG_STATUS_KEYS = BREVO_EMAIL_LOG_STATUSES.map((s) => s.key);

function normalizeBrevoLogStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-\s]+/g, '');
}

function getBrevoLogStatusFilter(value) {
  const key = normalizeBrevoLogStatus(value);
  if (!key) return null;
  return BREVO_EMAIL_LOG_STATUSES.find((s) => s.key === key) || null;
}

module.exports = {
  BREVO_EMAIL_LOG_STATUSES,
  BREVO_EMAIL_LOG_STATUS_KEYS,
  normalizeBrevoLogStatus,
  getBrevoLogStatusFilter,
};

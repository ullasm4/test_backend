const env = require('@/config/env');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

function getDefaultMailSender() {
  const email = String(env.SENDER_EMAIL || 'info@pem.co.in').trim().toLowerCase();
  const name = String(env.SENDER_NAME || 'PEM').trim() || email.split('@')[0] || 'PEM';

  return { email, name };
}

/**
 * Loads Brevo sender details: From address from SENDER_EMAIL env,
 * plus logged-in user profile for seller-outreach contact fields.
 */
async function loadBrevoMailSender(db, userId) {
  const from = getDefaultMailSender();

  const { rows } = await db.query(
    `
    SELECT id, name, phone, is_active
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    throw new ServerError('User account not found or inactive', 401, ErrorCode.UNAUTHORIZED);
  }

  return {
    id: user.id,
    email: from.email,
    name: from.name,
    personName: String(user.name || '').trim() || null,
    personPhone: String(user.phone || '').trim() || null,
  };
}

module.exports = {
  getDefaultMailSender,
  loadBrevoMailSender,
};

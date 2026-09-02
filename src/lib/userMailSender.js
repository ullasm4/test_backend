const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

/**
 * Loads the logged-in user's profile for use as Brevo mail sender (From address).
 * Each user must have an email set on their account in the users table.
 */
async function loadUserMailSender(db, userId) {
  const { rows } = await db.query(
    `
    SELECT id, name, email, phone, is_active
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

  const email = String(user.email || '').trim().toLowerCase();
  if (!email) {
    throw new ServerError(
      'Your account has no sender email. Ask admin to add your email in Users settings before sending Brevo mail.',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const name = String(user.name || '').trim() || email.split('@')[0] || 'PEM User';

  return {
    id: user.id,
    name,
    email,
    phone: String(user.phone || '').trim() || null,
  };
}

module.exports = {
  loadUserMailSender,
};

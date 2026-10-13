const jwt = require('jsonwebtoken');
const env = require('@/config/env');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next(new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED));
  }

  try {
    req.user = jwt.verify(token, env.JWT_SECRET);
    return next();
  } catch {
    return next(new ServerError('Invalid or expired token', 401, ErrorCode.UNAUTHORIZED));
  }
}

function isEndUser(user) {
  return user?.role === 'end_user';
}

/** Staff admin/user only — blocks portal end users from mutating admin APIs. */
function staffRequired(req, _res, next) {
  if (isEndUser(req.user)) {
    return next(new ServerError('Forbidden', 403, ErrorCode.FORBIDDEN));
  }
  return next();
}

/**
 * Requires admin role OR explicit permission granted in user's permissions array.
 */
function permissionRequired(permission) {
  return async (req, _res, next) => {
    if (req.user?.role === 'admin') {
      return next();
    }
    if (!req.user?.id) {
      return next(new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED));
    }
    try {
      const { pool } = require('@/service/db');
      const { rows } = await pool.query(
        'SELECT permissions FROM users WHERE id = $1 LIMIT 1',
        [req.user.id]
      );
      const user = rows[0];
      const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
      if (permissions.includes(permission)) {
        return next();
      }
      return next(
        new ServerError(
          `Access denied: ${permission} permission required`,
          403,
          ErrorCode.FORBIDDEN
        )
      );
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { authRequired, staffRequired, isEndUser, permissionRequired };


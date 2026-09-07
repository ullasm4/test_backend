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

module.exports = { authRequired, staffRequired, isEndUser };

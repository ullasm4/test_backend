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

module.exports = { authRequired };

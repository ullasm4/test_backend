const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

function errorHandler(err, _req, res, _next) {
  if (err instanceof ServerError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
    });
  }

  if (err && err.isJoi) {
    return res.status(400).json({
      error: err.details?.[0]?.message || 'Validation failed',
      code: ErrorCode.VALIDATION_ERROR,
    });
  }

  if (err && err.code === '23505') {
    return res.status(409).json({
      error: 'Phone or email already exists',
      code: ErrorCode.CONFLICT,
    });
  }

  console.error('unhandled', err);
  return res.status(500).json({
    error: 'Internal server error',
    code: ErrorCode.INTERNAL,
  });
}

module.exports = errorHandler;

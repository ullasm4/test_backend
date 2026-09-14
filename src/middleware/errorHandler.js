const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

function postgresMessage(err) {
  const code = err?.code;
  if (code === '42P01') {
    return 'A required database table is missing. Please run the latest migrations.';
  }
  if (code === '42703') {
    return 'A required database column is missing. Please run the latest migrations.';
  }
  if (code === '22P02') {
    return 'Invalid filter value. Please clear filters and try again.';
  }
  if (code === '23503') {
    return 'This record is linked to other data and cannot be updated this way.';
  }
  if (code === '23505') {
    return 'Phone or email already exists';
  }
  if (code === '23514') {
    return 'Invalid data value. Please check your input.';
  }
  if (code === '57014') {
    return 'The request took too long. Try narrowing your filters.';
  }
  return null;
}

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

  const pgMessage = postgresMessage(err);
  if (pgMessage) {
    const status = err.code === '23505' ? 409 : 400;
    const code = err.code === '23505' ? ErrorCode.CONFLICT : ErrorCode.BAD_REQUEST;
    return res.status(status).json({
      error: pgMessage,
      code,
    });
  }

  console.error('unhandled', err);
  return res.status(500).json({
    error: 'Internal server error',
    code: ErrorCode.INTERNAL,
  });
}

module.exports = errorHandler;

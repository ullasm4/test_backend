const ErrorCode = require('@/config/errorCode');

class ServerError extends Error {
  constructor(message, status = 500, code = ErrorCode.INTERNAL) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.code = code;
  }
}

module.exports = ServerError;

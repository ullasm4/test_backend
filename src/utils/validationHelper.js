const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

function validate(schema = {}) {
  return (req, res, next) => {
    try {
      if (schema.body) {
        const { value, error } = schema.body.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          throw new ServerError(error.details.map((d) => d.message).join(', '), 400, ErrorCode.VALIDATION_ERROR);
        }
        req.body = value;
      }

      if (schema.query) {
        const { value, error } = schema.query.validate(req.query, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        });
        if (error) {
          throw new ServerError(error.details.map((d) => d.message).join(', '), 400, ErrorCode.VALIDATION_ERROR);
        }
        req.customQuery = value;
      } else {
        req.customQuery = req.customQuery || {};
      }

      if (schema.params) {
        const { value, error } = schema.params.validate(req.params, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          throw new ServerError(error.details.map((d) => d.message).join(', '), 400, ErrorCode.VALIDATION_ERROR);
        }
        req.params = value;
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { validate, Joi };

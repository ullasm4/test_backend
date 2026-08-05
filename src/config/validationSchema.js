const Joi = require('joi');

const Schema = {
  uuid: () =>
    Joi.string().pattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    ),
  phone: () => Joi.string().trim().min(5).max(20),
  email: () => Joi.string().trim().email().allow('', null),
  pagination: {
    page: () => Joi.number().integer().min(1).default(1),
    limit: (max = 100) => Joi.number().integer().min(1).max(max).default(20),
  },
  search: () => Joi.string().trim().allow('').default(''),
  dateOnly: () => Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
};

module.exports = Schema;

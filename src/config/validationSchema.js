const Joi = require('joi');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const Schema = {
  uuid: () => Joi.string().pattern(UUID_RE),
  /** One UUID or comma-separated UUIDs (e.g. multi city filter). Normalizes spaces. */
  uuidList: (max = 50) =>
    Joi.string()
      .trim()
      .custom((value, helpers) => {
        if (value == null || value === '') return value;
        const ids = [
          ...new Set(
            String(value)
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          ),
        ];
        if (!ids.length || ids.length > max || !ids.every((id) => UUID_RE.test(id))) {
          return helpers.error('any.invalid');
        }
        return ids.join(',');
      }),
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

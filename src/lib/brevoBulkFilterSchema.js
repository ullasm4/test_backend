const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const { VALUE_RANGE_KEYS } = require('@/lib/contractValueRanges');
const { LISTING_TYPES } = require('@/config/listingType');
const { LEAD_STATUSES } = require('@/config/leadStatus');

/** Keep in sync with `@/lib/brevoBulkSellers` MAX_BULK_LIMIT (avoid circular require). */
const MAX_BULK_LIMIT = 5000;

/** Shared Sellers-list filters accepted by Brevo bulk preview/send. */
const brevoBulkSellerFilterFields = {
  // Do not use Schema.search() here — its `.default('')` always injects empty q.
  q: Joi.string().trim().optional().allow(''),
  state: Joi.string().trim().optional().allow(''),
  city_id: Schema.uuidList().optional().allow('', null),
  type: Joi.string()
    .valid(...LISTING_TYPES)
    .optional()
    .allow(''),
  status: Joi.string()
    .valid(...LEAD_STATUSES)
    .optional()
    .allow(''),
  gst_type: Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.array().items(Joi.string().trim()))
    .optional()
    .allow(''),
  'gst_type[]': Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.array().items(Joi.string().trim()))
    .optional()
    .allow(''),
  category: Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.array().items(Joi.string().trim()))
    .optional()
    .allow(''),
  'category[]': Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.array().items(Joi.string().trim()))
    .optional()
    .allow(''),
  categories: Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.array().items(Joi.string().trim()))
    .optional()
    .allow(''),
  has_phone: Joi.boolean().optional(),
  has_email: Joi.boolean().optional(),
  unique_phone: Joi.boolean().optional(),
  unique_email: Joi.boolean().optional(),
  unique_gst: Joi.boolean().optional(),
  remaining_whatsapp: Joi.boolean().optional(),
  remaining_email: Joi.boolean().optional(),
  assigned: Joi.boolean().optional(),
  unassigned: Joi.boolean().optional(),
  assigned_user_id: Schema.uuid().optional().allow(''),
  sort_value: Joi.string().trim().optional().allow(''),
  value_op: Joi.string().trim().optional().allow(''),
  value_amount: Joi.number().optional().allow('', null),
  value_range: Joi.string()
    .valid(...VALUE_RANGE_KEYS)
    .optional()
    .allow(''),
};

function pickSellerBulkFilters(source = {}) {
  const keys = Object.keys(brevoBulkSellerFilterFields);
  const filters = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      filters[key] = source[key];
    }
  }
  // Only truthy boolean filters matter (same as list sellers).
  for (const key of [
    'has_phone',
    'has_email',
    'unique_phone',
    'unique_email',
    'unique_gst',
    'remaining_whatsapp',
    'remaining_email',
    'assigned',
    'unassigned',
  ]) {
    if (source[key] === true || source[key] === 'true') {
      filters[key] = true;
    } else {
      delete filters[key];
    }
  }
  return filters;
}

module.exports = {
  MAX_BULK_LIMIT,
  brevoBulkSellerFilterFields,
  pickSellerBulkFilters,
  brevoBulkSellerFiltersQuerySchema: Joi.object({
    limit: Joi.number().integer().min(1).max(MAX_BULK_LIMIT).required(),
    ...brevoBulkSellerFilterFields,
  }),
  brevoBulkSellerFiltersBodySchema: Joi.object({
    limit: Joi.number().integer().min(1).max(MAX_BULK_LIMIT).required(),
    template_id: Joi.number().integer().positive().required(),
    templateId: Joi.number().integer().positive().optional(),
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
    ...brevoBulkSellerFilterFields,
  }),
};

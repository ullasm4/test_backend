const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const {
  BREVO_EMAIL_LOG_STATUS_KEYS,
  getBrevoLogStatusFilter,
  normalizeBrevoLogStatus,
} = require('@/config/brevoEmailLogStatus');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Normalized event expression from last_webhook_event JSON. */
const LAST_EVENT_EXPR = `
  lower(
    replace(
      replace(
        replace(coalesce(l.response_payload->'last_webhook_event'->>'event', ''), '_', ''),
        '-',
        ''
      ),
      ' ',
      ''
    )
  )
`;

exports.validationSchema = {
  query: Joi.object({
    q: Schema.search(),
    date: Joi.string().trim().pattern(DATE_PATTERN).optional(),
    status: Joi.string()
      .trim()
      .allow('')
      .optional()
      .custom((value, helpers) => {
        const normalized = normalizeBrevoLogStatus(value);
        if (!normalized) return '';
        if (!BREVO_EMAIL_LOG_STATUS_KEYS.includes(normalized)) {
          return helpers.error('any.only');
        }
        return normalized;
      }),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const q = req.customQuery.q || '';
  const date = req.customQuery.date || '';
  const statusFilter = getBrevoLogStatusFilter(req.customQuery.status || '');

  const params = [];
  const clauses = [
    'l.seller_id IS NOT NULL',
    `NOT EXISTS (
      SELECT 1
      FROM user_assign_sellers uas
      WHERE uas.seller_id = l.seller_id
    )`,
  ];

  if (date) {
    params.push(date);
    clauses.push(`l.sent_at >= $${params.length}::date`);
    params.push(date);
    clauses.push(`l.sent_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      l.company_name ILIKE $${params.length} OR
      l.gem_seller_id ILIKE $${params.length} OR
      l.email ILIKE $${params.length} OR
      l.subject ILIKE $${params.length}
    )`);
  }

  if (statusFilter) {
    if (statusFilter.key === 'pending') {
      clauses.push(`(
        l.response_payload->'last_webhook_event' IS NULL
        OR NULLIF(BTRIM(COALESCE(l.response_payload->'last_webhook_event'->>'event', '')), '') IS NULL
      )`);
    } else {
      params.push(statusFilter.match);
      clauses.push(`${LAST_EVENT_EXPR} = ANY($${params.length}::text[])`);
    }
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  const { rows } = await db.query(
    `
    SELECT DISTINCT l.seller_id
    FROM seller_email_log l
    JOIN new_seller_details sd ON sd.id = l.seller_id
    ${where}
    ORDER BY l.seller_id ASC
    `,
    params
  );

  const sellerIds = rows.map((r) => r.seller_id);

  return res.status(200).json({
    seller_ids: sellerIds,
    total: sellerIds.length,
  });
};

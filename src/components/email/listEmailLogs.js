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
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(),
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
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const date = req.customQuery.date || '';
  const statusFilter = getBrevoLogStatusFilter(req.customQuery.status || '');

  const params = [];
  const clauses = [];

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

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM seller_email_log l ${where}`, params),
    db.query(
      `
      SELECT
        l.id,
        l.seller_id,
        l.gem_seller_id,
        l.company_name,
        l.email,
        si.phone,
        l.subject,
        l.source,
        COALESCE(l.response_payload->>'message', '') AS message,
        l.response_payload->>'message_id' AS message_id,
        l.response_payload->>'template_id' AS template_id,
        l.response_payload->>'provider' AS provider,
        l.response_payload->'last_webhook_event' AS last_webhook_event,
        l.sent_by,
        u.name AS sent_by_name,
        u.email AS sent_by_email,
        l.sent_at
      FROM seller_email_log l
      LEFT JOIN users u ON u.id = l.sent_by
      LEFT JOIN LATERAL (
        SELECT x.phone
        FROM new_seller_information x
        WHERE l.seller_id IS NOT NULL
          AND x.seller_id = l.seller_id
        ORDER BY
          (x.phone IS NOT NULL AND BTRIM(x.phone) <> '') DESC,
          x.id
        LIMIT 1
      ) si ON TRUE
      ${where}
      ORDER BY l.sent_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
      `,
      dataParams
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};

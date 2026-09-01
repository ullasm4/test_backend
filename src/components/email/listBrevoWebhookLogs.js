const Joi = require('joi');
const Schema = require('@/config/validationSchema');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(),
    q: Schema.search(),
    event_type: Joi.string().trim().optional(),
    date: Joi.string().trim().pattern(DATE_PATTERN).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const eventType = req.customQuery.event_type || '';
  const date = req.customQuery.date || '';

  const params = [];
  const clauses = [];

  if (date) {
    params.push(date);
    clauses.push(`created_at >= $${params.length}::date`);
    params.push(date);
    clauses.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (eventType) {
    params.push(eventType);
    clauses.push(`event_type = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      email ILIKE $${params.length} OR
      subject ILIKE $${params.length} OR
      message_id ILIKE $${params.length} OR
      event_type ILIKE $${params.length}
    )`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM brevo_webhook_log ${where}`, params),
    db.query(
      `
      SELECT
        id,
        event_type,
        email,
        message_id,
        subject,
        reason,
        event_timestamp,
        payload,
        created_at
      FROM brevo_webhook_log
      ${where}
      ORDER BY created_at DESC
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

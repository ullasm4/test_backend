const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');

exports.validationSchema = {
  query: Joi.object({
    message_id: Joi.string().trim().min(1).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to view Brevo email details', 401, ErrorCode.UNAUTHORIZED);
  }

  const normalizedId = normalizeMessageId(req.customQuery.message_id);

  if (!normalizedId) {
    throw new ServerError('message_id is required', 400, ErrorCode.VALIDATION_ERROR);
  }

  const sendLogMatch = messageIdMatchSql("l.response_payload->>'message_id'");
  const webhookMatch = messageIdMatchSql('message_id');

  const [sendLogRes, eventsRes] = await Promise.all([
    db.query(
      `
      SELECT
        l.id,
        l.seller_id,
        l.gem_seller_id,
        l.company_name,
        l.email,
        l.subject,
        l.source,
        l.response_payload->>'message_id' AS message_id,
        l.response_payload->>'template_id' AS template_id,
        l.response_payload->>'provider' AS provider,
        l.response_payload->>'sender_email' AS sender_email,
        l.response_payload->>'sender_name' AS sender_name,
        l.response_payload->'last_webhook_event' AS last_webhook_event,
        u.name AS sent_by_name,
        u.email AS sent_by_email,
        l.sent_at
      FROM seller_email_log l
      LEFT JOIN users u ON u.id = l.sent_by
      WHERE ${sendLogMatch} = $1
      ORDER BY l.sent_at DESC
      LIMIT 1
      `,
      [normalizedId]
    ),
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
      WHERE ${webhookMatch} = $1
      ORDER BY event_timestamp ASC NULLS LAST, created_at ASC
      `,
      [normalizedId]
    ),
  ]);

  return res.status(200).json({
    message_id: normalizedId,
    send_log: sendLogRes.rows[0] || null,
    webhook_events: eventsRes.rows,
    latest_event: eventsRes.rows.length
      ? eventsRes.rows[eventsRes.rows.length - 1]
      : sendLogRes.rows[0]?.last_webhook_event
        ? {
            event_type: sendLogRes.rows[0].last_webhook_event.event,
            reason: sendLogRes.rows[0].last_webhook_event.reason || null,
            event_timestamp: sendLogRes.rows[0].last_webhook_event.received_at,
            message_id: normalizeMessageId(sendLogRes.rows[0].last_webhook_event.message_id) || normalizedId,
          }
        : null,
  });
};

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
  const brevoIdMatch = messageIdMatchSql("l.response_payload->>'brevo_message_id'");
  const webhookMatch = messageIdMatchSql('message_id');

  const sendLogRes = await db.query(
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
      l.response_payload->>'brevo_message_id' AS brevo_message_id,
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
       OR ${brevoIdMatch} = $1
    ORDER BY l.sent_at DESC
    LIMIT 1
    `,
    [normalizedId]
  );

  const sendLog = sendLogRes.rows[0] || null;
  const sendEmail = String(sendLog?.email || '').trim().toLowerCase() || null;
  const brevoMessageId = normalizeMessageId(sendLog?.brevo_message_id) || null;
  const sentAt = sendLog?.sent_at ? new Date(sendLog.sent_at) : null;
  // Look up webhook events a bit before send through +7 days (covers clock skew + delivery lag).
  const windowStart = sentAt
    ? new Date(sentAt.getTime() - 5 * 60 * 1000)
    : null;
  const windowEnd = sentAt
    ? new Date(sentAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;

  const eventsRes = await db.query(
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
       OR ($2::text IS NOT NULL AND ${webhookMatch} = $2)
       OR (
         $3::text IS NOT NULL
         AND LOWER(BTRIM(email)) = $3
         AND (
           $4::timestamptz IS NULL
           OR COALESCE(event_timestamp, created_at) >= $4
         )
         AND (
           $5::timestamptz IS NULL
           OR COALESCE(event_timestamp, created_at) <= $5
         )
       )
    ORDER BY event_timestamp ASC NULLS LAST, created_at ASC
    `,
    [normalizedId, brevoMessageId, sendEmail, windowStart, windowEnd]
  );

  const webhookEvents = eventsRes.rows;
  const latestFromWebhook = webhookEvents.length ? webhookEvents[webhookEvents.length - 1] : null;

  // Backfill last_webhook_event when SMTP Message-ID never matched Brevo's ID,
  // but events already exist in brevo_webhook_log (so Refresh status can heal Pending).
  if (
    sendLog?.id &&
    latestFromWebhook &&
    (!sendLog.last_webhook_event || !sendLog.last_webhook_event.event)
  ) {
    const linkedBrevoId = normalizeMessageId(latestFromWebhook.message_id);
    await db.query(
      `
      UPDATE seller_email_log
      SET response_payload = jsonb_set(
        CASE
          WHEN $2::text IS NULL THEN COALESCE(response_payload, '{}'::jsonb)
          ELSE jsonb_set(
            COALESCE(response_payload, '{}'::jsonb),
            '{brevo_message_id}',
            to_jsonb($2::text),
            true
          )
        END,
        '{last_webhook_event}',
        $1::jsonb
      )
      WHERE id = $3
      `,
      [
        JSON.stringify({
          event: latestFromWebhook.event_type,
          message_id: linkedBrevoId,
          received_at: new Date().toISOString(),
          reason: latestFromWebhook.reason || null,
        }),
        linkedBrevoId,
        sendLog.id,
      ]
    );

    sendLog.last_webhook_event = {
      event: latestFromWebhook.event_type,
      message_id: linkedBrevoId,
      received_at: new Date().toISOString(),
      reason: latestFromWebhook.reason || null,
    };
    if (linkedBrevoId) {
      sendLog.brevo_message_id = linkedBrevoId;
    }
  }

  return res.status(200).json({
    message_id: normalizedId,
    send_log: sendLog,
    webhook_events: webhookEvents,
    latest_event: latestFromWebhook
      ? latestFromWebhook
      : sendLog?.last_webhook_event
        ? {
            event_type: sendLog.last_webhook_event.event,
            reason: sendLog.last_webhook_event.reason || null,
            event_timestamp: sendLog.last_webhook_event.received_at,
            message_id:
              normalizeMessageId(sendLog.last_webhook_event.message_id) ||
              brevoMessageId ||
              normalizedId,
          }
        : null,
  });
};

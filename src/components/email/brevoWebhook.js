const Joi = require('joi');
const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');
const { recordBrevoWebhookEvent } = require('@/lib/brevoNotificationSync');

async function updateSellerEmailLogLastEvent(db, webhookRow, reason) {
  const email = String(webhookRow.email || '').trim().toLowerCase();
  const messageId = normalizeMessageId(webhookRow.message_id);
  if (!email) return;

  const eventJson = JSON.stringify({
    event: webhookRow.event_type,
    message_id: messageId,
    received_at: new Date().toISOString(),
    reason: reason || null,
  });

  // 1) Prefer exact message_id match (REST API sends share Brevo's ID with webhooks).
  if (messageId) {
    const byMessageId = await db.query(
      `
      UPDATE seller_email_log
      SET response_payload = jsonb_set(
        COALESCE(response_payload, '{}'::jsonb),
        '{last_webhook_event}',
        $1::jsonb
      )
      WHERE LOWER(email) = $2
        AND sent_at >= NOW() - INTERVAL '7 days'
        AND (
          ${messageIdMatchSql("response_payload->>'message_id'")} = $3
          OR ${messageIdMatchSql("response_payload->>'brevo_message_id'")} = $3
        )
      RETURNING id
      `,
      [eventJson, email, messageId]
    );
    if (byMessageId.rowCount > 0) return;
  }

  // 2) Fallback by recipient email.
  // SMTP transport stores nodemailer's Message-ID, which does not match Brevo webhook
  // message-id values — without this fallback status stays Pending forever.
  await db.query(
    `
    UPDATE seller_email_log
    SET response_payload = jsonb_set(
      CASE
        WHEN $3::text IS NULL THEN COALESCE(response_payload, '{}'::jsonb)
        ELSE jsonb_set(
          COALESCE(response_payload, '{}'::jsonb),
          '{brevo_message_id}',
          to_jsonb($3::text),
          true
        )
      END,
      '{last_webhook_event}',
      $1::jsonb
    )
    WHERE id = (
      SELECT l.id
      FROM seller_email_log l
      WHERE LOWER(BTRIM(l.email)) = $2
        AND l.source = 'brevo-email'
        AND l.sent_at >= NOW() - INTERVAL '7 days'
      ORDER BY l.sent_at DESC
      LIMIT 1
    )
    `,
    [eventJson, email, messageId]
  );
}

exports.validationSchema = {
  body: Joi.alternatives().try(
    Joi.object().unknown(true),
    Joi.array().items(Joi.object().unknown(true)).min(1)
  ).required(),
};

exports.controller = async (req, res, _next, db) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const processedEvents = [];

  for (const item of events) {
    if (!item || typeof item !== 'object') continue;

    try {
      const { webhookRow, notification } = await recordBrevoWebhookEvent(db, item);
      if (!webhookRow) continue;

      if (notification.created) {
        console.log(
          `[notifications] created #${notification.notification_id} for user ${notification.user_id} (${webhookRow.event_type})`
        );
      }

      await updateSellerEmailLogLastEvent(db, webhookRow, item.reason);
      processedEvents.push({
        event: webhookRow.event_type,
        email: webhookRow.email,
        messageId: webhookRow.message_id,
        notification_created: Boolean(notification.created),
      });
    } catch (err) {
      console.error('Error processing Brevo webhook event:', {
        event: item.event || item.event_type,
        email: item.email,
        error: err.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Brevo webhook received successfully',
    processedCount: processedEvents.length,
    processedEvents,
  });
};

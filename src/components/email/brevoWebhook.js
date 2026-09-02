const Joi = require('joi');
const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');
const { recordBrevoWebhookEvent } = require('@/lib/brevoNotificationSync');

async function updateSellerEmailLogLastEvent(db, webhookRow, reason) {
  const email = String(webhookRow.email || '').trim().toLowerCase();
  const messageId = normalizeMessageId(webhookRow.message_id);
  if (!email) return;

  const updateParams = [
    JSON.stringify({
      event: webhookRow.event_type,
      message_id: messageId,
      received_at: new Date().toISOString(),
      reason: reason || null,
    }),
    email,
  ];

  let updateSql = `
    UPDATE seller_email_log
    SET response_payload = jsonb_set(
      COALESCE(response_payload, '{}'::jsonb),
      '{last_webhook_event}',
      $1::jsonb
    )
    WHERE LOWER(email) = $2
      AND sent_at >= NOW() - INTERVAL '7 days'
  `;

  if (messageId) {
    updateParams.push(messageId);
    updateSql += `
      AND ${messageIdMatchSql("response_payload->>'message_id'")} = $${updateParams.length}
    `;
  }

  await db.query(updateSql, updateParams);
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

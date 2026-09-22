const { recordBrevoWebhookEvent } = require('@/lib/brevoNotificationSync');
const { applyWebhookEventToSellerLog } = require('@/lib/brevoWebhookApply');

/**
 * Brevo may post a single object, an array, or a wrapper like { events: [...] }.
 */
function extractWebhookItems(body) {
  if (Array.isArray(body)) return body.filter((item) => item && typeof item === 'object');
  if (!body || typeof body !== 'object') return [];

  for (const key of ['events', 'items', 'webhooks', 'data']) {
    if (Array.isArray(body[key])) {
      return body[key].filter((item) => item && typeof item === 'object');
    }
  }

  // Single event object (most common Brevo shape).
  if (body.event || body.event_type || body.email || body['message-id'] || body.messageId) {
    return [body];
  }

  return [];
}

// No Joi validation — Brevo payloads vary; always accept and ACK with 200.
exports.validationSchema = {};

exports.controller = async (req, res, _next, db) => {
  const events = extractWebhookItems(req.body);
  const processedEvents = [];
  let skipped = 0;

  console.log(
    `[brevo-webhook] received ${events.length} event(s) content-type=${req.headers['content-type'] || 'n/a'}`
  );

  for (const item of events) {
    try {
      const { webhookRow, notification } = await recordBrevoWebhookEvent(db, item);
      if (!webhookRow) {
        skipped += 1;
        console.warn('[brevo-webhook] skipped invalid event payload', {
          keys: Object.keys(item || {}),
          event: item?.event || item?.event_type || null,
          email: item?.email || null,
        });
        continue;
      }

      if (notification.created) {
        console.log(
          `[notifications] created #${notification.notification_id} for user ${notification.user_id} (${webhookRow.event_type})`
        );
      }

      const applyResult = await applyWebhookEventToSellerLog(db, webhookRow, item.reason);
      processedEvents.push({
        event: webhookRow.event_type,
        email: webhookRow.email,
        messageId: webhookRow.message_id,
        notification_created: Boolean(notification.created),
        log_updated: Boolean(applyResult.updated),
        apply_reason: applyResult.reason || null,
      });
    } catch (err) {
      console.error('Error processing Brevo webhook event:', {
        event: item.event || item.event_type,
        email: item.email,
        error: err.message,
      });
    }
  }

  // Always 200 so Brevo does not disable the webhook after retries.
  return res.status(200).json({
    success: true,
    message: 'Brevo webhook received successfully',
    receivedCount: events.length,
    processedCount: processedEvents.length,
    skippedCount: skipped,
    processedEvents,
  });
};

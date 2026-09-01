const Joi = require('joi');
const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');

function parseEventTimestamp(item) {
  const tsEpoch = item.ts_epoch;
  if (tsEpoch != null && !Number.isNaN(Number(tsEpoch))) {
    return new Date(Number(tsEpoch));
  }

  const tsSeconds = item.ts_event ?? item.ts;
  if (tsSeconds != null && !Number.isNaN(Number(tsSeconds))) {
    return new Date(Number(tsSeconds) * 1000);
  }

  return new Date();
}

exports.validationSchema = {
  body: Joi.alternatives().try(
    Joi.object().unknown(true),
    Joi.array().items(Joi.object().unknown(true)).min(1)
  ).required(),
};

exports.controller = async (req, res, _next, db) => {
  const body = req.body || {};
  const events = Array.isArray(body) ? body : [body];

  const processedEvents = [];

  for (const item of events) {
    if (!item || typeof item !== 'object') continue;

    const eventType = String(item.event || item.event_type || '').trim();
    const email = String(item.email || '').trim().toLowerCase();
    const messageId = normalizeMessageId(item['message-id'] || item.messageId);
    const subject = String(item.subject || '').trim();
    const reason = item.reason ? String(item.reason).trim() : null;
    const eventTimestamp = parseEventTimestamp(item);

    if (!email || !eventType) continue;

    try {
      // 1. Insert into brevo_webhook_log
      await db.query(
        `
        INSERT INTO brevo_webhook_log (
          event_type,
          email,
          message_id,
          subject,
          reason,
          event_timestamp,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        [
          eventType,
          email,
          messageId || null,
          subject || null,
          reason || null,
          eventTimestamp,
          JSON.stringify(item),
        ]
      );

      // 2. If matching seller_email_log exists, record delivery status in response_payload
      if (email) {
        const updateParams = [
          JSON.stringify({
            event: eventType,
            message_id: messageId,
            received_at: new Date().toISOString(),
            reason: reason,
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

      processedEvents.push({ event: eventType, email, messageId });
    } catch (err) {
      console.error('Error inserting Brevo webhook event:', {
        eventType,
        email,
        error: err.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Brevo webhook received successfully',
    processedCount: processedEvents.length,
  });
};

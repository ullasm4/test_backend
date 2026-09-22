const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');

/**
 * Higher rank wins. Prevents a late "request/sent" webhook from overwriting
 * delivered/opened/click status on seller_email_log.
 */
const EVENT_RANK = Object.freeze({
  request: 10,
  sent: 15,
  deferred: 20,
  delivered: 30,
  opened: 40,
  uniqueopened: 45,
  click: 50,
  clicked: 50,
  softbounce: 60,
  soft_bounce: 60,
  unsubscribed: 65,
  hardbounce: 70,
  hard_bounce: 70,
  invalid: 70,
  blocked: 70,
  spam: 70,
  error: 70,
});

function normalizeEventKey(eventType) {
  return String(eventType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

function getEventRank(eventType) {
  const key = normalizeEventKey(eventType);
  if (!key) return 0;
  if (EVENT_RANK[key] != null) return EVENT_RANK[key];
  // uniqueOpened → uniqueopened already via replace; keep underscore variants.
  const compact = key.replace(/_/g, '');
  return EVENT_RANK[compact] || 25;
}

function shouldReplaceWebhookEvent(currentEvent, nextEvent) {
  if (!currentEvent) return true;
  return getEventRank(nextEvent) >= getEventRank(currentEvent);
}

/**
 * Attach a Brevo webhook event onto the matching seller_email_log row.
 * Match order: explicit logId → message_id / brevo_message_id → latest send by recipient email.
 */
async function applyWebhookEventToSellerLog(db, webhookRow, reason = null, options = {}) {
  const email = String(webhookRow?.email || '').trim().toLowerCase();
  const messageId = normalizeMessageId(webhookRow?.message_id);
  const eventType = String(webhookRow?.event_type || '').trim();
  const forcedLogId = options.logId || null;
  if ((!email && !forcedLogId) || !eventType) {
    return { updated: false, reason: 'missing_email_or_event' };
  }

  const eventJson = {
    event: eventType,
    message_id: messageId,
    received_at: new Date().toISOString(),
    reason: reason || null,
  };

  let target = null;

  if (forcedLogId) {
    const byForced = await db.query(
      `
      SELECT
        id,
        response_payload->'last_webhook_event'->>'event' AS current_event
      FROM seller_email_log
      WHERE id = $1
      LIMIT 1
      `,
      [forcedLogId]
    );
    target = byForced.rows[0] || null;
  }

  if (!target && messageId && email) {
    const byId = await db.query(
      `
      SELECT
        id,
        response_payload->'last_webhook_event'->>'event' AS current_event
      FROM seller_email_log
      WHERE LOWER(BTRIM(email)) = $1
        AND sent_at >= NOW() - INTERVAL '7 days'
        AND (
          ${messageIdMatchSql("response_payload->>'message_id'")} = $2
          OR ${messageIdMatchSql("response_payload->>'brevo_message_id'")} = $2
        )
      ORDER BY sent_at DESC
      LIMIT 1
      `,
      [email, messageId]
    );
    target = byId.rows[0] || null;
  }

  if (!target && email) {
    const byEmail = await db.query(
      `
      SELECT
        id,
        response_payload->'last_webhook_event'->>'event' AS current_event
      FROM seller_email_log
      WHERE LOWER(BTRIM(email)) = $1
        AND source = 'brevo-email'
        AND sent_at >= NOW() - INTERVAL '7 days'
      ORDER BY sent_at DESC
      LIMIT 1
      `,
      [email]
    );
    target = byEmail.rows[0] || null;
  }

  if (!target?.id) {
    return { updated: false, reason: 'no_matching_send_log' };
  }

  if (!shouldReplaceWebhookEvent(target.current_event, eventType)) {
    // Still store Brevo message id for future exact matches.
    if (messageId) {
      await db.query(
        `
        UPDATE seller_email_log
        SET response_payload = jsonb_set(
          COALESCE(response_payload, '{}'::jsonb),
          '{brevo_message_id}',
          to_jsonb($1::text),
          true
        )
        WHERE id = $2
          AND (
            response_payload->>'brevo_message_id' IS NULL
            OR BTRIM(response_payload->>'brevo_message_id') = ''
          )
        `,
        [messageId, target.id]
      );
    }
    return { updated: false, reason: 'kept_stronger_event', log_id: target.id };
  }

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
    [JSON.stringify(eventJson), messageId, target.id]
  );

  return { updated: true, log_id: target.id };
}

module.exports = {
  EVENT_RANK,
  getEventRank,
  shouldReplaceWebhookEvent,
  applyWebhookEventToSellerLog,
};

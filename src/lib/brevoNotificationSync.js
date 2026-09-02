const { normalizeMessageId, messageIdMatchSql } = require('@/lib/messageId');
const { loadSellerForBrevo } = require('@/lib/brevoSellerLookup');

const NOTIFIER_EVENTS = new Set([
  'delivered',
  'opened',
  'uniqueopened',
  'click',
  'hardbounce',
  'softbounce',
  'invalid',
  'blocked',
  'spam',
  'deferred',
]);

function normalizeEventType(eventType) {
  return String(eventType || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, '');
}

function shouldNotifyForEvent(eventType) {
  return NOTIFIER_EVENTS.has(normalizeEventType(eventType));
}

function formatEventLabel(eventType) {
  const value = normalizeEventType(eventType);
  if (!value) return 'Update';
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildNotificationContent({ eventType, companyName, sellerEmail, link }) {
  const company = String(companyName || sellerEmail || 'Seller').trim() || 'Seller';
  const normalized = normalizeEventType(eventType);

  switch (normalized) {
    case 'delivered':
      return {
        title: 'Email delivered',
        message: `${company} received your Brevo email.`,
      };
    case 'opened':
    case 'uniqueopened':
      return {
        title: 'Email opened',
        message: `${company} opened your email.`,
      };
    case 'click':
      return {
        title: 'Link clicked',
        message: link
          ? `${company} clicked a link in your email: ${link}`
          : `${company} clicked a link in your email.`,
      };
    case 'hardbounce':
    case 'softbounce':
      return {
        title: 'Email bounced',
        message: `Your email to ${company} bounced (${formatEventLabel(eventType)}).`,
      };
    case 'invalid':
    case 'blocked':
    case 'spam':
    case 'deferred':
      return {
        title: 'Email delivery issue',
        message: `Brevo reported ${formatEventLabel(eventType)} for your email to ${company}.`,
      };
    default:
      return {
        title: formatEventLabel(eventType),
        message: `Brevo reported ${formatEventLabel(eventType)} for your email to ${company}.`,
      };
  }
}

async function findSellerEmailLogForWebhook(db, { messageId, email }) {
  const normalizedId = normalizeMessageId(messageId);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const sendLogMatch = messageIdMatchSql("l.response_payload->>'message_id'");
  const selectSql = `
    SELECT
      l.id,
      l.seller_id,
      l.company_name,
      l.email,
      l.subject,
      l.sent_by,
      l.response_payload->>'message_id' AS message_id
    FROM seller_email_log l
    WHERE l.source = 'brevo-email'
  `;

  if (normalizedId) {
    const byMessageId = await db.query(
      `${selectSql} AND ${sendLogMatch} = $1 ORDER BY l.sent_at DESC LIMIT 1`,
      [normalizedId]
    );
    if (byMessageId.rows[0]) return byMessageId.rows[0];
  }

  if (!normalizedEmail) return null;

  const byEmail = await db.query(
    `
    ${selectSql}
      AND LOWER(BTRIM(l.email)) = $1
      AND l.sent_at >= NOW() - INTERVAL '30 days'
    ORDER BY CASE WHEN l.seller_id IS NOT NULL THEN 0 ELSE 1 END, l.sent_at DESC
    LIMIT 1
    `,
    [normalizedEmail]
  );

  return byEmail.rows[0] || null;
}

async function resolveSellerIdForNotification(db, sendLog, email) {
  if (sendLog?.seller_id) {
    return sendLog.seller_id;
  }

  const normalizedEmail = String(email || sendLog?.email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const seller = await loadSellerForBrevo(db, { email: normalizedEmail });
  return seller?.seller_uuid || null;
}

function parseWebhookPayload(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value || '{}');
    } catch {
      return {};
    }
  }
  return {};
}

function parseEventTimestamp(item) {
  const tsEpoch = item?.ts_epoch;
  if (tsEpoch != null && !Number.isNaN(Number(tsEpoch))) {
    return new Date(Number(tsEpoch));
  }

  const tsSeconds = item?.ts_event ?? item?.ts;
  if (tsSeconds != null && !Number.isNaN(Number(tsSeconds))) {
    return new Date(Number(tsSeconds) * 1000);
  }

  return new Date();
}

function resolveNotificationCreatedAt(webhookRow) {
  const eventTs = webhookRow?.event_timestamp;
  if (eventTs) {
    const date = new Date(eventTs);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const createdAt = webhookRow?.created_at;
  if (createdAt) {
    const date = new Date(createdAt);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return new Date();
}

async function insertNotification(
  db,
  { userId, title, message, sellerId, messageId, eventType, webhookLogId, createdAt = new Date() }
) {
  const { rows } = await db.query(
    `
    INSERT INTO notifications (
      user_id,
      title,
      message,
      is_read,
      seller_id,
      message_id,
      event_type,
      webhook_log_id,
      created_at
    )
    VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8)
    ON CONFLICT (webhook_log_id) WHERE webhook_log_id IS NOT NULL DO NOTHING
    RETURNING id, created_at
    `,
    [
      userId,
      title.slice(0, 255),
      message,
      sellerId || null,
      messageId || null,
      eventType || null,
      webhookLogId || null,
      createdAt,
    ]
  );

  return rows[0] || null;
}

async function insertBrevoWebhookLog(db, item) {
  const eventType = String(item.event || item.event_type || '').trim();
  const email = String(item.email || '').trim().toLowerCase();
  const messageId = normalizeMessageId(item['message-id'] || item.messageId);
  const subject = String(item.subject || '').trim();
  const reason = item.reason ? String(item.reason).trim() : null;
  const eventTimestamp = parseEventTimestamp(item);

  if (!email || !eventType) {
    return null;
  }

  const insertResult = await db.query(
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
    RETURNING
      id,
      event_type,
      email,
      message_id,
      subject,
      reason,
      event_timestamp,
      payload,
      created_at
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

  return insertResult.rows[0] || null;
}

async function createNotificationForWebhookEvent(db, webhookRow) {
  const eventType = String(webhookRow?.event_type || '').trim();
  if (!shouldNotifyForEvent(eventType)) {
    return { created: false, reason: 'ignored_event' };
  }

  const payload = parseWebhookPayload(webhookRow?.payload);
  const email = String(webhookRow?.email || payload.email || '').trim().toLowerCase();
  const messageId = normalizeMessageId(webhookRow?.message_id || payload['message-id'] || payload.messageId);
  const link = typeof payload.link === 'string' ? payload.link.trim() : null;

  const sendLog = await findSellerEmailLogForWebhook(db, { messageId, email });
  if (!sendLog?.sent_by) {
    return { created: false, reason: 'no_sender' };
  }

  const sellerId = await resolveSellerIdForNotification(db, sendLog, email);
  const content = buildNotificationContent({
    eventType,
    companyName: sendLog.company_name,
    sellerEmail: sendLog.email || email,
    link,
  });
  const createdAt = resolveNotificationCreatedAt(webhookRow);

  const row = await insertNotification(db, {
    userId: sendLog.sent_by,
    title: content.title,
    message: content.message,
    sellerId,
    messageId: messageId || sendLog.message_id || null,
    eventType,
    webhookLogId: webhookRow.id,
    createdAt,
  });

  return {
    created: Boolean(row),
    notification_id: row?.id || null,
    created_at: row?.created_at || createdAt,
    user_id: sendLog.sent_by,
    seller_id: sellerId || null,
  };
}

async function createEmailSentNotification(db, { userId, sellerId, email, companyName, messageId }) {
  if (!userId) return { created: false, reason: 'no_user' };

  const company = String(companyName || email || 'seller').trim() || 'seller';
  const row = await insertNotification(db, {
    userId,
    title: 'Email sent',
    message: `Your Brevo email to ${company} was sent successfully.`,
    sellerId,
    messageId,
    eventType: 'sent',
  });

  return { created: Boolean(row), notification_id: row?.id || null };
}

async function backfillMissedNotifications(db, limit = 500) {
  const { rows } = await db.query(
    `
    SELECT
      w.id,
      w.event_type,
      w.email,
      w.message_id,
      w.subject,
      w.reason,
      w.event_timestamp,
      w.payload,
      w.created_at
    FROM brevo_webhook_log w
    LEFT JOIN notifications n ON n.webhook_log_id = w.id
    WHERE n.id IS NULL
    ORDER BY w.created_at ASC
    LIMIT $1
    `,
    [limit]
  );

  let created = 0;
  for (const row of rows) {
    const result = await createNotificationForWebhookEvent(db, row);
    if (result.created) created += 1;
  }

  return { processed: rows.length, created };
}

async function recordBrevoWebhookEvent(db, item) {
  const webhookRow = await insertBrevoWebhookLog(db, item);
  if (!webhookRow) {
    return { webhookRow: null, notification: { created: false, reason: 'invalid_event' } };
  }

  const notification = await createNotificationForWebhookEvent(db, webhookRow);
  return { webhookRow, notification };
}

module.exports = {
  recordBrevoWebhookEvent,
  createEmailSentNotification,
  backfillMissedNotifications,
};

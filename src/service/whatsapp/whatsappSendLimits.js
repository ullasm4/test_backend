const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { toWhatsAppDestination, normalizeIndianPhoneDigits } = require('@/service/whatsapp/extractPhones');

const SELLER_WHATSAPP_COOLDOWN_DAYS = 6;

function formatDateLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeDestination(phone) {
  const destination = toWhatsAppDestination(phone);
  if (destination) return destination;
  const digits = normalizeIndianPhoneDigits(phone);
  return digits || null;
}

/**
 * Latest WhatsApp send for this seller_id and/or destination phone.
 */
async function getSellerWhatsAppCooldown(db, { sellerId, phone }) {
  const sellerUuid = sellerId || null;
  const destination = normalizeDestination(phone);

  if (!sellerUuid && !destination) {
    return {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: SELLER_WHATSAPP_COOLDOWN_DAYS,
    };
  }

  const { rows } = await db.query(
    `
    SELECT
      MAX(l.sent_at) AS last_sent_at,
      MAX(l.sent_at) + ($3::int * INTERVAL '1 day') AS next_allowed_at
    FROM seller_whatsapp_log l
    WHERE (
        ($1::uuid IS NOT NULL AND l.seller_id = $1::uuid)
        OR (
          $2::text IS NOT NULL
          AND (
            l.destination = $2::text
            OR l.phone = $2::text
            OR RIGHT(REGEXP_REPLACE(COALESCE(l.destination, l.phone, ''), '\\D', '', 'g'), 10) = RIGHT($2::text, 10)
          )
        )
      )
      AND l.sent_at > NOW() - ($3::int * INTERVAL '1 day')
    `,
    [sellerUuid, destination, SELLER_WHATSAPP_COOLDOWN_DAYS]
  );

  const row = rows[0] || {};
  const nextAllowedAt = row.next_allowed_at ? new Date(row.next_allowed_at) : null;
  const now = new Date();
  const onCooldown = Boolean(nextAllowedAt && nextAllowedAt > now);

  return {
    allowed: !onCooldown,
    last_sent_at: row.last_sent_at || null,
    next_allowed_at: onCooldown ? row.next_allowed_at : null,
    cooldown_days: SELLER_WHATSAPP_COOLDOWN_DAYS,
  };
}

/**
 * Batch cooldown lookup for seller list rows.
 */
async function getSellerWhatsAppCooldownsForRows(db, sellers = []) {
  const result = new Map();
  if (!Array.isArray(sellers) || !sellers.length) return result;

  const sellerIds = [];
  const destinations = [];
  const seenSeller = new Set();
  const seenDestination = new Set();

  for (const seller of sellers) {
    const id = seller?.id;
    if (id && !seenSeller.has(id)) {
      seenSeller.add(id);
      sellerIds.push(id);
    }
    const destination = normalizeDestination(seller?.phone);
    if (destination && !seenDestination.has(destination)) {
      seenDestination.add(destination);
      destinations.push(destination);
    }
  }

  if (!sellerIds.length && !destinations.length) return result;

  const { rows } = await db.query(
    `
    SELECT
      l.seller_id,
      l.destination,
      MAX(l.sent_at) AS last_sent_at,
      MAX(l.sent_at) + ($3::int * INTERVAL '1 day') AS next_allowed_at
    FROM seller_whatsapp_log l
    WHERE l.sent_at > NOW() - ($3::int * INTERVAL '1 day')
      AND (
        (cardinality($1::uuid[]) > 0 AND l.seller_id = ANY ($1::uuid[]))
        OR (
          cardinality($2::text[]) > 0
          AND l.destination = ANY ($2::text[])
        )
      )
    GROUP BY l.seller_id, l.destination
    `,
    [sellerIds, destinations, SELLER_WHATSAPP_COOLDOWN_DAYS]
  );

  const now = new Date();
  const bySellerId = new Map();
  const byDestination = new Map();

  for (const row of rows || []) {
    const nextAllowedAt = row.next_allowed_at ? new Date(row.next_allowed_at) : null;
    if (!nextAllowedAt || nextAllowedAt <= now) continue;

    const payload = {
      allowed: false,
      last_sent_at: row.last_sent_at || null,
      next_allowed_at: row.next_allowed_at,
      cooldown_days: SELLER_WHATSAPP_COOLDOWN_DAYS,
    };

    if (row.seller_id) {
      const prev = bySellerId.get(row.seller_id);
      if (!prev || new Date(payload.next_allowed_at) > new Date(prev.next_allowed_at)) {
        bySellerId.set(row.seller_id, payload);
      }
    }

    const destination = String(row.destination || '').trim();
    if (destination) {
      const prev = byDestination.get(destination);
      if (!prev || new Date(payload.next_allowed_at) > new Date(prev.next_allowed_at)) {
        byDestination.set(destination, payload);
      }
    }
  }

  for (const seller of sellers) {
    if (!seller?.id) continue;
    const destination = normalizeDestination(seller.phone);
    const fromSeller = bySellerId.get(seller.id);
    const fromDestination = destination ? byDestination.get(destination) : null;

    let chosen = null;
    if (fromSeller && fromDestination) {
      chosen =
        new Date(fromSeller.next_allowed_at) >= new Date(fromDestination.next_allowed_at)
          ? fromSeller
          : fromDestination;
    } else {
      chosen = fromSeller || fromDestination || null;
    }

    result.set(
      seller.id,
      chosen || {
        allowed: true,
        last_sent_at: null,
        next_allowed_at: null,
        cooldown_days: SELLER_WHATSAPP_COOLDOWN_DAYS,
      }
    );
  }

  return result;
}

async function assertSellerWhatsAppSendAllowed(db, { sellerId, phone }) {
  const cooldown = await getSellerWhatsAppCooldown(db, { sellerId, phone });
  if (!cooldown.allowed) {
    throw new ServerError(
      `WhatsApp already sent. ${SELLER_WHATSAPP_COOLDOWN_DAYS}-day gap required. Next message on ${formatDateLabel(cooldown.next_allowed_at)}.`,
      400,
      ErrorCode.BAD_REQUEST
    );
  }
  return cooldown;
}

module.exports = {
  SELLER_WHATSAPP_COOLDOWN_DAYS,
  formatDateLabel,
  getSellerWhatsAppCooldown,
  getSellerWhatsAppCooldownsForRows,
  assertSellerWhatsAppSendAllowed,
};

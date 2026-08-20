const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

const SELLER_MAIL_COOLDOWN_DAYS = 6;
const DIRECT_MAIL_COOLDOWN_DAYS = 6;

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

/**
 * Latest successful seller email for this seller_id and/or recipient email.
 * Cooldown is shared by seller and by email address.
 */
async function getSellerMailCooldown(db, { sellerId, email, cooldownDays = SELLER_MAIL_COOLDOWN_DAYS }) {
  const sellerUuid = sellerId || null;
  const normalizedEmail = String(email || '').trim().toLowerCase() || null;
  const days = Number(cooldownDays) > 0 ? Number(cooldownDays) : SELLER_MAIL_COOLDOWN_DAYS;

  if (!sellerUuid && !normalizedEmail) {
    return {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: days,
    };
  }

  const { rows } = await db.query(
    `
    SELECT
      MAX(l.sent_at) AS last_sent_at,
      MAX(l.sent_at) + ($3::int * INTERVAL '1 day') AS next_allowed_at
    FROM seller_email_log l
    WHERE (
        ($1::uuid IS NOT NULL AND l.seller_id = $1::uuid)
        OR (
          $2::text IS NOT NULL
          AND LOWER(BTRIM(l.email)) = $2::text
        )
      )
      AND l.sent_at > NOW() - ($3::int * INTERVAL '1 day')
    `,
    [sellerUuid, normalizedEmail, days]
  );

  const row = rows[0] || {};
  const nextAllowedAt = row.next_allowed_at ? new Date(row.next_allowed_at) : null;
  const now = new Date();
  const onCooldown = Boolean(nextAllowedAt && nextAllowedAt > now);

  return {
    allowed: !onCooldown,
    last_sent_at: row.last_sent_at || null,
    next_allowed_at: onCooldown ? row.next_allowed_at : null,
    cooldown_days: days,
  };
}

/**
 * Batch cooldown lookup for seller list rows.
 * Returns Map<sellerId, cooldown>.
 */
async function getSellerMailCooldownsForRows(db, sellers = []) {
  const result = new Map();
  if (!Array.isArray(sellers) || !sellers.length) return result;

  const sellerIds = [];
  const emails = [];
  const seenSeller = new Set();
  const seenEmail = new Set();

  for (const seller of sellers) {
    const id = seller?.id;
    if (id && !seenSeller.has(id)) {
      seenSeller.add(id);
      sellerIds.push(id);
    }
    const email = String(seller?.email || '').trim().toLowerCase();
    if (email && !seenEmail.has(email)) {
      seenEmail.add(email);
      emails.push(email);
    }
  }

  if (!sellerIds.length && !emails.length) return result;

  const { rows } = await db.query(
    `
    SELECT
      l.seller_id,
      LOWER(BTRIM(l.email)) AS email,
      MAX(l.sent_at) AS last_sent_at,
      MAX(l.sent_at) + ($3::int * INTERVAL '1 day') AS next_allowed_at
    FROM seller_email_log l
    WHERE l.sent_at > NOW() - ($3::int * INTERVAL '1 day')
      AND (
        (cardinality($1::uuid[]) > 0 AND l.seller_id = ANY ($1::uuid[]))
        OR (
          cardinality($2::text[]) > 0
          AND LOWER(BTRIM(l.email)) = ANY ($2::text[])
        )
      )
    GROUP BY l.seller_id, LOWER(BTRIM(l.email))
    `,
    [sellerIds, emails, SELLER_MAIL_COOLDOWN_DAYS]
  );

  const now = new Date();
  const bySellerId = new Map();
  const byEmail = new Map();

  for (const row of rows || []) {
    const nextAllowedAt = row.next_allowed_at ? new Date(row.next_allowed_at) : null;
    if (!nextAllowedAt || nextAllowedAt <= now) continue;

    const payload = {
      allowed: false,
      last_sent_at: row.last_sent_at || null,
      next_allowed_at: row.next_allowed_at,
      cooldown_days: SELLER_MAIL_COOLDOWN_DAYS,
    };

    if (row.seller_id) {
      const prev = bySellerId.get(row.seller_id);
      if (!prev || new Date(payload.next_allowed_at) > new Date(prev.next_allowed_at)) {
        bySellerId.set(row.seller_id, payload);
      }
    }

    const email = String(row.email || '').trim().toLowerCase();
    if (email) {
      const prev = byEmail.get(email);
      if (!prev || new Date(payload.next_allowed_at) > new Date(prev.next_allowed_at)) {
        byEmail.set(email, payload);
      }
    }
  }

  for (const seller of sellers) {
    if (!seller?.id) continue;
    const email = String(seller.email || '').trim().toLowerCase();
    const fromSeller = bySellerId.get(seller.id);
    const fromEmail = email ? byEmail.get(email) : null;

    let chosen = null;
    if (fromSeller && fromEmail) {
      chosen =
        new Date(fromSeller.next_allowed_at) >= new Date(fromEmail.next_allowed_at)
          ? fromSeller
          : fromEmail;
    } else {
      chosen = fromSeller || fromEmail || null;
    }

    result.set(
      seller.id,
      chosen || {
        allowed: true,
        last_sent_at: null,
        next_allowed_at: null,
        cooldown_days: SELLER_MAIL_COOLDOWN_DAYS,
      }
    );
  }

  return result;
}

async function assertSellerMailSendAllowed(db, { sellerId, email, cooldownDays = SELLER_MAIL_COOLDOWN_DAYS }) {
  const days = Number(cooldownDays) > 0 ? Number(cooldownDays) : SELLER_MAIL_COOLDOWN_DAYS;
  const cooldown = await getSellerMailCooldown(db, { sellerId, email, cooldownDays: days });
  if (!cooldown.allowed) {
    throw new ServerError(
      `Mail already sent. ${days}-day gap required. Next mail on ${formatDateLabel(cooldown.next_allowed_at)}.`,
      400,
      ErrorCode.BAD_REQUEST
    );
  }
  return cooldown;
}

async function assertDirectMailSendAllowed(db, { sellerId, email }) {
  return assertSellerMailSendAllowed(db, {
    sellerId,
    email,
    cooldownDays: DIRECT_MAIL_COOLDOWN_DAYS,
  });
}

module.exports = {
  SELLER_MAIL_COOLDOWN_DAYS,
  DIRECT_MAIL_COOLDOWN_DAYS,
  formatDateLabel,
  getSellerMailCooldown,
  getSellerMailCooldownsForRows,
  assertSellerMailSendAllowed,
  assertDirectMailSendAllowed,
};

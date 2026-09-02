const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');
const { SELLER_MAIL_COOLDOWN_DAYS } = require('@/service/mail/mailSendLimits');

const MAX_BULK_LIMIT = 5000;

function buildEligibleCteSql(isAdmin) {
  const assignmentJoin = isAdmin
    ? ''
    : 'JOIN user_assign_sellers uas ON uas.seller_id = sd.id AND uas.user_id = $1';

  const cooldownRef = isAdmin ? '$1' : '$2';

  return `
    recent_seller_ids AS (
      SELECT DISTINCT l.seller_id
      FROM seller_email_log l
      WHERE l.sent_at > NOW() - (${cooldownRef}::int * INTERVAL '1 day')
        AND l.seller_id IS NOT NULL
    ),
    recent_emails AS (
      SELECT DISTINCT LOWER(BTRIM(l.email)) AS email
      FROM seller_email_log l
      WHERE l.sent_at > NOW() - (${cooldownRef}::int * INTERVAL '1 day')
        AND l.email IS NOT NULL
        AND BTRIM(l.email) <> ''
    ),
    eligible AS (
      SELECT
        sd.id AS seller_uuid,
        sd.seller_id AS gem_seller_id,
        sd.company_name,
        COALESCE(sd.total_value, 0) AS total_value,
        LOWER(BTRIM(si.email)) AS email
      FROM new_seller_details sd
      ${PRIMARY_SELLER_CONTACT}
      ${assignmentJoin}
      WHERE si.email IS NOT NULL
        AND BTRIM(si.email) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM recent_seller_ids rs WHERE rs.seller_id = sd.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM recent_emails re WHERE re.email = LOWER(BTRIM(si.email))
        )
    )
  `;
}

async function countEligibleBulkSellersUpTo(db, { userId, isAdmin, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), MAX_BULK_LIMIT);
  const limitParam = isAdmin ? '$2' : '$3';
  const params = isAdmin
    ? [SELLER_MAIL_COOLDOWN_DAYS, safeLimit]
    : [userId, SELLER_MAIL_COOLDOWN_DAYS, safeLimit];

  const { rows } = await db.query(
    `
    WITH ${buildEligibleCteSql(isAdmin)}
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT 1
      FROM eligible
      ORDER BY seller_uuid
      LIMIT ${limitParam}
    ) batch
    `,
    params
  );

  return rows[0]?.total || 0;
}

async function listEligibleBulkSellers(db, { userId, isAdmin, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), MAX_BULK_LIMIT);
  if (!safeLimit) return [];

  const limitParam = isAdmin ? '$2' : '$3';
  const params = isAdmin
    ? [SELLER_MAIL_COOLDOWN_DAYS, safeLimit]
    : [userId, SELLER_MAIL_COOLDOWN_DAYS, safeLimit];

  const { rows } = await db.query(
    `
    WITH ${buildEligibleCteSql(isAdmin)}
    SELECT seller_uuid, gem_seller_id, company_name, total_value, email
    FROM eligible
    ORDER BY seller_uuid
    LIMIT ${limitParam}
    `,
    params
  );

  return rows;
}

module.exports = {
  MAX_BULK_LIMIT,
  SELLER_MAIL_COOLDOWN_DAYS,
  countEligibleBulkSellersUpTo,
  listEligibleBulkSellers,
};

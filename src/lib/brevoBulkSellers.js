const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');
const { SELLER_MAIL_COOLDOWN_DAYS } = require('@/service/mail/mailSendLimits');
const { appendSellerListFilters } = require('@/lib/appendSellerListFilters');

const MAX_BULK_LIMIT = 5000;

function buildEligibleCteSql(isAdmin, extraWhereSql = '') {
  const assignmentJoin = isAdmin
    ? ''
    : 'JOIN user_assign_sellers uas ON uas.seller_id = sd.id AND uas.user_id = $1';

  const extraWhere = extraWhereSql ? ` AND ${extraWhereSql}` : '';

  // Bulk send is once-only: skip anyone already emailed (sticky flag or any prior log).
  // NOT EXISTS (correlated) avoids materializing full distinct ID/email sets from large logs.
  return `
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
        AND sd.email_sent IS NOT TRUE
        AND sd.email_sent_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM seller_email_log l
          WHERE l.seller_id = sd.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM seller_email_log l
          WHERE LOWER(BTRIM(l.email)) = LOWER(BTRIM(si.email))
        )
        ${extraWhere}
    )
  `;
}

async function resolveEligibleQuery(db, { userId, isAdmin, filters = {} }) {
  const params = isAdmin ? [] : [userId];
  const clauses = [];

  const { orderBy } = await appendSellerListFilters(db, filters, params, clauses, {
    // Non-admins are already scoped via assignment join; only admins apply list assignment filters.
    includeAssignmentFilters: Boolean(isAdmin),
  });

  const extraWhereSql = clauses.length ? clauses.join(' AND ') : '';
  return {
    cteSql: buildEligibleCteSql(isAdmin, extraWhereSql),
    params,
    orderBy,
  };
}

async function countEligibleBulkSellers(db, { userId, isAdmin, filters = {} }) {
  const { cteSql, params } = await resolveEligibleQuery(db, { userId, isAdmin, filters });
  const { rows } = await db.query(
    `
    WITH ${cteSql}
    SELECT COUNT(*)::int AS total
    FROM eligible
    `,
    params
  );
  return rows[0]?.total || 0;
}

async function countEligibleBulkSellersUpTo(db, { userId, isAdmin, limit, filters = {} }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), MAX_BULK_LIMIT);
  const { cteSql, params, orderBy } = await resolveEligibleQuery(db, { userId, isAdmin, filters });
  params.push(safeLimit);
  const limitParam = `$${params.length}`;

  const { rows } = await db.query(
    `
    WITH ${cteSql}
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT 1
      FROM eligible
      ORDER BY ${orderBy}
      LIMIT ${limitParam}
    ) batch
    `,
    params
  );

  return rows[0]?.total || 0;
}

/**
 * Single round-trip for preview: eligible total + how many will send for this limit.
 * Avoids two parallel counts drifting or doubling load on large filtered sets.
 */
async function previewEligibleBulkSellers(db, { userId, isAdmin, limit, filters = {} }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), MAX_BULK_LIMIT);
  const { cteSql, params, orderBy } = await resolveEligibleQuery(db, { userId, isAdmin, filters });
  params.push(safeLimit);
  const limitParam = `$${params.length}`;

  const { rows } = await db.query(
    `
    WITH ${cteSql},
    totals AS (
      SELECT COUNT(*)::int AS eligible_total FROM eligible
    ),
    batch AS (
      SELECT COUNT(*)::int AS will_send
      FROM (
        SELECT 1
        FROM eligible
        ORDER BY ${orderBy}
        LIMIT ${limitParam}
      ) t
    )
    SELECT totals.eligible_total, batch.will_send
    FROM totals, batch
    `,
    params
  );

  return {
    eligible_total: rows[0]?.eligible_total || 0,
    will_send: rows[0]?.will_send || 0,
  };
}

async function listEligibleBulkSellers(db, { userId, isAdmin, limit, filters = {} }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), MAX_BULK_LIMIT);
  if (!safeLimit) return [];

  const { cteSql, params, orderBy } = await resolveEligibleQuery(db, { userId, isAdmin, filters });
  params.push(safeLimit);
  const limitParam = `$${params.length}`;

  const { rows } = await db.query(
    `
    WITH ${cteSql}
    SELECT seller_uuid, gem_seller_id, company_name, total_value, email
    FROM eligible
    ORDER BY ${orderBy}
    LIMIT ${limitParam}
    `,
    params
  );

  return rows;
}

module.exports = {
  MAX_BULK_LIMIT,
  SELLER_MAIL_COOLDOWN_DAYS,
  countEligibleBulkSellers,
  countEligibleBulkSellersUpTo,
  previewEligibleBulkSellers,
  listEligibleBulkSellers,
};

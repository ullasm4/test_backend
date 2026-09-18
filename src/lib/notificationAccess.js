const env = require('@/config/env');

const DEFAULT_RETENTION_HOURS = 24;

function getNotificationRetentionHours() {
  const hours = Number(env.NOTIFICATION_RETENTION_HOURS);
  return Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : DEFAULT_RETENTION_HOURS;
}

function isNotificationAdmin(user) {
  return user?.role === 'admin';
}

function buildNotificationAccessConditions(user, { tableAlias = 'n', paramOffset = 0 } = {}) {
  if (isNotificationAdmin(user)) {
    return { conditions: [], params: [] };
  }

  const userParam = `$${paramOffset + 1}`;
  return {
    conditions: [`${tableAlias}.user_id = ${userParam}`],
    params: [user.id],
  };
}

/**
 * Always scope lists/counts to the retention window so stale rows never show
 * even before the cleanup cron deletes them.
 */
function buildNotificationFilter(
  user,
  { unreadOnly = false, tableAlias = 'n', retentionHours = getNotificationRetentionHours() } = {}
) {
  const { conditions, params } = buildNotificationAccessConditions(user, { tableAlias });

  params.push(retentionHours);
  conditions.push(
    `${tableAlias}.created_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`
  );

  if (unreadOnly) {
    conditions.push(`${tableAlias}.is_read = FALSE`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    retention_hours: retentionHours,
  };
}

module.exports = {
  DEFAULT_RETENTION_HOURS,
  getNotificationRetentionHours,
  isNotificationAdmin,
  buildNotificationAccessConditions,
  buildNotificationFilter,
};

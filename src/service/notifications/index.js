const { pool } = require('@/service/db');
const { backfillMissedNotifications } = require('@/lib/brevoNotificationSync');
const {
  DEFAULT_RETENTION_HOURS,
  getNotificationRetentionHours,
} = require('@/lib/notificationAccess');

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let cleanupTimer = null;
let cleanupRunning = false;

async function deleteExpiredNotifications(db, retentionHours = DEFAULT_RETENTION_HOURS) {
  const hours = Math.max(Number(retentionHours) || DEFAULT_RETENTION_HOURS, 1);

  const { rows } = await db.query(
    `
    DELETE FROM notifications
    WHERE created_at < NOW() - ($1::int * INTERVAL '1 hour')
    RETURNING id
    `,
    [hours]
  );

  return { deleted: rows.length, retention_hours: hours };
}

async function runNotificationCleanup() {
  if (cleanupRunning) return { skipped: true };
  cleanupRunning = true;

  try {
    const retentionHours = getNotificationRetentionHours();
    const result = await deleteExpiredNotifications(pool, retentionHours);
    if (result.deleted > 0) {
      console.log(
        `[notifications] deleted ${result.deleted} notification(s) older than ${result.retention_hours}h`
      );
    }
    return result;
  } catch (error) {
    console.error('[notifications] cleanup failed:', error?.message || error);
    return { error: error?.message || 'cleanup_failed' };
  } finally {
    cleanupRunning = false;
  }
}

function scheduleNotificationCleanup() {
  if (cleanupTimer) return;

  const retentionHours = getNotificationRetentionHours();

  // Clean on startup, then every 15 minutes so 24h expiry is enforced promptly.
  runNotificationCleanup().catch(() => {});

  cleanupTimer = setInterval(() => {
    runNotificationCleanup().catch(() => {});
  }, CLEANUP_INTERVAL_MS);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  console.log(
    `[notifications] cleanup every ${CLEANUP_INTERVAL_MS / 60000}m (retention ${retentionHours}h)`
  );
}

function startNotificationCrons() {
  scheduleNotificationCleanup();

  backfillMissedNotifications(pool, 500)
    .then((result) => {
      if (result.created > 0) {
        console.log(
          `[notifications] backfilled ${result.created} notification(s) from ${result.processed} webhook event(s)`
        );
      }
    })
    .catch((error) => {
      console.error('[notifications] backfill failed:', error?.message || error);
    });
}

module.exports = {
  startNotificationCrons,
  deleteExpiredNotifications,
  runNotificationCleanup,
};

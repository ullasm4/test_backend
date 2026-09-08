const env = require('@/config/env');
const { pool } = require('@/service/db');
const { backfillMissedNotifications } = require('@/lib/brevoNotificationSync');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_HOURS = 24;

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
    const result = await deleteExpiredNotifications(pool, env.NOTIFICATION_RETENTION_HOURS);
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

function scheduleNotificationCleanupHourly() {
  if (cleanupTimer) return;

  const retentionHours = env.NOTIFICATION_RETENTION_HOURS || DEFAULT_RETENTION_HOURS;

  // Clean up on startup, then every hour
  runNotificationCleanup().catch(() => {});

  cleanupTimer = setInterval(() => {
    runNotificationCleanup().catch(() => {});
  }, HOUR_MS);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  console.log(
    `[notifications] cleanup scheduled every 1 hour (retention ${retentionHours}h)`
  );
}

function startNotificationCrons() {
  scheduleNotificationCleanupHourly();

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
};

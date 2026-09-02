const env = require('@/config/env');
const { pool } = require('@/service/db');
const { backfillMissedNotifications } = require('@/lib/brevoNotificationSync');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_HOURS = 24;

let cleanupTimer = null;
let cleanupRunning = false;

function getNextMidnight() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next;
}

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

function scheduleNotificationCleanupAtMidnight() {
  if (cleanupTimer) return;

  const delay = getNextMidnight().getTime() - Date.now();
  const nextRun = getNextMidnight().toLocaleString();

  cleanupTimer = setTimeout(function onMidnight() {
    runNotificationCleanup()
      .catch(() => {})
      .finally(() => {
        cleanupTimer = setInterval(() => {
          runNotificationCleanup().catch(() => {});
        }, DAY_MS);

        if (typeof cleanupTimer.unref === 'function') {
          cleanupTimer.unref();
        }
      });
  }, delay);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  console.log(
    `[notifications] cleanup scheduled daily at 12:00 AM (next run: ${nextRun}, retention ${env.NOTIFICATION_RETENTION_HOURS || DEFAULT_RETENTION_HOURS}h)`
  );
}

function startNotificationCrons() {
  scheduleNotificationCleanupAtMidnight();

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

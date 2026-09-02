-- migrate:up

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS seller_id UUID,
  ADD COLUMN IF NOT EXISTS message_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS webhook_log_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_webhook_log_id
  ON notifications (webhook_log_id)
  WHERE webhook_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read
  ON notifications (user_id, is_read);

-- migrate:down

DROP INDEX IF EXISTS idx_notifications_user_id_is_read;
DROP INDEX IF EXISTS idx_notifications_user_id_created_at;
DROP INDEX IF EXISTS idx_notifications_webhook_log_id;

ALTER TABLE notifications
  DROP COLUMN IF EXISTS webhook_log_id,
  DROP COLUMN IF EXISTS event_type,
  DROP COLUMN IF EXISTS message_id,
  DROP COLUMN IF EXISTS seller_id;

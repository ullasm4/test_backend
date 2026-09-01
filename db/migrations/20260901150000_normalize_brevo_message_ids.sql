-- migrate:up

UPDATE public.brevo_webhook_log
SET message_id = split_part(
  REPLACE(REPLACE(COALESCE(message_id, ''), '<', ''), '>', ''),
  '@',
  1
)
WHERE message_id IS NOT NULL
  AND (message_id LIKE '%@%' OR message_id LIKE '<%');

UPDATE public.seller_email_log
SET response_payload = jsonb_set(
  COALESCE(response_payload, '{}'::jsonb),
  '{message_id}',
  to_jsonb(
    split_part(
      REPLACE(REPLACE(COALESCE(response_payload->>'message_id', ''), '<', ''), '>', ''),
      '@',
      1
    )
  ),
  true
)
WHERE COALESCE(response_payload->>'message_id', '') <> ''
  AND (
    response_payload->>'message_id' LIKE '%@%'
    OR response_payload->>'message_id' LIKE '<%'
  );

UPDATE public.seller_email_log
SET response_payload = jsonb_set(
  response_payload,
  '{last_webhook_event,message_id}',
  to_jsonb(
    split_part(
      REPLACE(REPLACE(COALESCE(response_payload->'last_webhook_event'->>'message_id', ''), '<', ''), '>', ''),
      '@',
      1
    )
  ),
  true
)
WHERE COALESCE(response_payload->'last_webhook_event'->>'message_id', '') <> ''
  AND (
    response_payload->'last_webhook_event'->>'message_id' LIKE '%@%'
    OR response_payload->'last_webhook_event'->>'message_id' LIKE '<%'
  );

-- migrate:down

-- Data normalization is not reversed on rollback.

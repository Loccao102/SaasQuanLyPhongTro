BEGIN;

ALTER TABLE notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_message_override_length_chk,
  DROP COLUMN IF EXISTS message_body_override;

COMMIT;

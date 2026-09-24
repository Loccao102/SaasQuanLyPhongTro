BEGIN;

ALTER TABLE notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_message_override_length_chk,
  DROP COLUMN IF EXISTS message_body_override;

DROP INDEX IF EXISTS notification_campaigns_source_idx;

ALTER TABLE notification_campaigns
  DROP CONSTRAINT IF EXISTS notification_campaigns_source_pair_chk,
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS source_type;

COMMIT;

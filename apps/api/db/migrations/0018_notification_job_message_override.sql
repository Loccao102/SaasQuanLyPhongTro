BEGIN;

ALTER TABLE notification_campaigns
  ADD COLUMN source_type text,
  ADD COLUMN source_id uuid;

ALTER TABLE notification_campaigns
  ADD CONSTRAINT notification_campaigns_source_pair_chk
  CHECK (
    (source_type IS NULL AND source_id IS NULL)
    OR
    (source_type IS NOT NULL AND source_id IS NOT NULL)
  );

CREATE INDEX notification_campaigns_source_idx
  ON notification_campaigns (
    organization_id,
    source_type,
    source_id,
    created_at DESC
  )
  WHERE source_type IS NOT NULL;

ALTER TABLE notification_jobs
  ADD COLUMN message_body_override text;

ALTER TABLE notification_jobs
  ADD CONSTRAINT notification_jobs_message_override_length_chk
  CHECK (
    message_body_override IS NULL
    OR char_length(message_body_override) BETWEEN 1 AND 4000
  );

COMMIT;

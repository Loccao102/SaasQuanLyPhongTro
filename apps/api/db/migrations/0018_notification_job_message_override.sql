BEGIN;

ALTER TABLE notification_jobs
  ADD COLUMN message_body_override text;

ALTER TABLE notification_jobs
  ADD CONSTRAINT notification_jobs_message_override_length_chk
  CHECK (
    message_body_override IS NULL
    OR char_length(message_body_override) BETWEEN 1 AND 4000
  );

COMMIT;

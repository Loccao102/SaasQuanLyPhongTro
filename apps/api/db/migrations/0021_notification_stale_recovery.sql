BEGIN;

DROP INDEX IF EXISTS notification_jobs_claim_idx;

CREATE INDEX notification_jobs_claim_idx
  ON notification_jobs (
    provider,
    status,
    next_attempt_at,
    updated_at,
    created_at
  )
  WHERE status IN ('QUEUED', 'RETRY_WAIT', 'RUNNING');

COMMIT;

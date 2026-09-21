BEGIN;

CREATE TABLE notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_reservation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  channel text NOT NULL,
  provider text NOT NULL,
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN (
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'PARTIAL_FAILED',
      'MANUAL_REVIEW',
      'PAUSED',
      'CANCELLED'
    )),
  total_recipients integer NOT NULL CHECK (total_recipients > 0),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, quota_reservation_id)
    REFERENCES automation_quota_reservations(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX notification_campaigns_status_idx
  ON notification_campaigns (organization_id, status, created_at DESC);

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  recipient_key text NOT NULL,
  recipient_display_name text,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN (
      'QUEUED',
      'RUNNING',
      'RETRY_WAIT',
      'SENT',
      'FAILED',
      'MANUAL_REVIEW',
      'CANCELLED'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz,
  idempotency_key text NOT NULL,
  verification_state text NOT NULL DEFAULT 'NOT_ATTEMPTED'
    CHECK (verification_state IN (
      'NOT_ATTEMPTED',
      'VERIFIED',
      'AMBIGUOUS',
      'UNKNOWN'
    )),
  last_error_code text,
  last_error_message text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, campaign_id)
    REFERENCES notification_campaigns(organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, campaign_id, recipient_key)
);

CREATE INDEX notification_jobs_claim_idx
  ON notification_jobs (provider, status, next_attempt_at, created_at)
  WHERE status IN ('QUEUED', 'RETRY_WAIT');

CREATE INDEX notification_jobs_campaign_idx
  ON notification_jobs (organization_id, campaign_id, status, created_at);

CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  provider text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('RUNNING', 'FINISHED')),
  outcome text
    CHECK (
      outcome IS NULL OR outcome IN (
        'SENT',
        'TRANSIENT_FAILURE',
        'PERMANENT_FAILURE',
        'MANUAL_REVIEW',
        'UNKNOWN'
      )
    ),
  error_code text,
  error_message text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id, job_id)
    REFERENCES notification_jobs(organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, job_id, attempt_number)
);

CREATE INDEX notification_attempts_job_idx
  ON notification_attempts (
    organization_id,
    job_id,
    attempt_number DESC
  );

COMMIT;

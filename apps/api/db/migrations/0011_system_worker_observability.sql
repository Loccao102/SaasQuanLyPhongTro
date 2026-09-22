BEGIN;

CREATE TABLE system_worker_heartbeats (
  worker_id text PRIMARY KEY,
  role text NOT NULL
    CHECK (role IN ('NOTIFICATION', 'BILLING', 'BILLING_WEBHOOK')),
  provider text,
  status text NOT NULL
    CHECK (status IN ('STARTING', 'HEALTHY', 'DEGRADED', 'STOPPING')),
  stale_after_seconds integer NOT NULL
    CHECK (stale_after_seconds BETWEEN 30 AND 86400),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX system_worker_heartbeats_role_seen_idx
  ON system_worker_heartbeats (role, last_seen_at DESC);

CREATE INDEX system_worker_heartbeats_status_seen_idx
  ON system_worker_heartbeats (status, last_seen_at DESC);

COMMIT;

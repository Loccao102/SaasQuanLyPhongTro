BEGIN;

CREATE TABLE notification_provider_controls (
  provider text PRIMARY KEY,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAUSED')),
  reason text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_worker_heartbeats (
  worker_id text PRIMARY KEY,
  provider text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('STARTING', 'HEALTHY', 'DEGRADED', 'STOPPING')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  last_error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_worker_heartbeats_provider_seen_idx
  ON notification_worker_heartbeats (provider, last_seen_at DESC);

COMMIT;

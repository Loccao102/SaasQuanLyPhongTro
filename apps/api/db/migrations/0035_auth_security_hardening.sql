BEGIN;

CREATE TABLE auth_rate_limit_buckets (
  action text NOT NULL,
  key_hash bytea NOT NULL,
  window_start timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action, key_hash, window_start)
);

CREATE INDEX auth_rate_limit_buckets_updated_at_idx
  ON auth_rate_limit_buckets (updated_at);

CREATE TABLE auth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'BLOCKED')),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  identifier_hash bytea,
  ip_hash bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_security_events_occurred_at_idx
  ON auth_security_events (occurred_at DESC);

CREATE INDEX auth_security_events_user_idx
  ON auth_security_events (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX auth_security_events_organization_idx
  ON auth_security_events (organization_id, occurred_at DESC)
  WHERE organization_id IS NOT NULL;

COMMIT;

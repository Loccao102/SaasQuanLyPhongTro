BEGIN;

CREATE TABLE auth_security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid REFERENCES auth_security_events(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  severity text NOT NULL
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (source_event_id, alert_type)
);

CREATE INDEX auth_security_alerts_user_idx
  ON auth_security_alerts (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX auth_security_alerts_created_idx
  ON auth_security_alerts (created_at DESC);

CREATE INDEX auth_security_alerts_delivery_idx
  ON auth_security_alerts (delivery_status, created_at)
  WHERE delivery_status IN ('PENDING', 'FAILED');

COMMIT;

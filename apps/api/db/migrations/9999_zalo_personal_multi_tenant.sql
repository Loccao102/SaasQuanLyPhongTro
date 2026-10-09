-- One encrypted Zalo Personal browser session per SaaS organization.
-- The API stores only ciphertext; the worker owns the encryption key.
CREATE TABLE IF NOT EXISTS zalo_personal_accounts (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED','CONNECTING','CONNECTED')),
  encrypted_session text,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zalo_personal_connected_has_session CHECK (
    status <> 'CONNECTED' OR encrypted_session IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS zalo_personal_login_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','CONNECTED','FAILED','EXPIRED','CANCELLED')),
  qr_image text,
  error_message text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zalo_login_pending
  ON zalo_personal_login_requests (status, created_at)
  WHERE status IN ('PENDING','RUNNING');
CREATE INDEX IF NOT EXISTS idx_zalo_login_org
  ON zalo_personal_login_requests (organization_id, created_at DESC);

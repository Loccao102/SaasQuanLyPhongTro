BEGIN;

CREATE TABLE membership_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES organization_memberships (organization_id, id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX membership_invitations_open_membership_uidx
  ON membership_invitations (organization_id, membership_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX membership_invitations_membership_history_idx
  ON membership_invitations (
    organization_id,
    membership_id,
    created_at DESC,
    id
  );

CREATE INDEX membership_invitations_expiry_idx
  ON membership_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMIT;

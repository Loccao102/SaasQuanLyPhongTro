BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN reauthenticated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_purpose_check;

ALTER TABLE auth_webauthn_challenges
  ADD COLUMN session_id uuid REFERENCES auth_sessions(id) ON DELETE CASCADE;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_purpose_check
  CHECK (purpose IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP'));

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_check;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_context_check
  CHECK (
    (purpose = 'REGISTRATION' AND parent_mfa_token_hash IS NULL AND session_id IS NULL)
    OR
    (purpose = 'AUTHENTICATION' AND parent_mfa_token_hash IS NOT NULL AND session_id IS NULL)
    OR
    (purpose = 'STEP_UP' AND parent_mfa_token_hash IS NULL AND session_id IS NOT NULL)
  );

CREATE INDEX auth_sessions_reauthenticated_idx
  ON auth_sessions (user_id, reauthenticated_at DESC)
  WHERE revoked_at IS NULL;

COMMIT;

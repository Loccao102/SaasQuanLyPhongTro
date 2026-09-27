BEGIN;

DROP INDEX IF EXISTS auth_sessions_reauthenticated_idx;

DELETE FROM auth_webauthn_challenges
WHERE purpose = 'STEP_UP';

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_context_check;

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_purpose_check;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_purpose_check
  CHECK (purpose IN ('REGISTRATION', 'AUTHENTICATION'));

ALTER TABLE auth_webauthn_challenges
  DROP COLUMN IF EXISTS session_id;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_check
  CHECK (
    (purpose = 'REGISTRATION' AND parent_mfa_token_hash IS NULL)
    OR
    (purpose = 'AUTHENTICATION' AND parent_mfa_token_hash IS NOT NULL)
  );

ALTER TABLE auth_sessions
  DROP COLUMN IF EXISTS reauthenticated_at;

COMMIT;

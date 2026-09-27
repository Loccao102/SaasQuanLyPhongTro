BEGIN;

DELETE FROM auth_webauthn_challenges
WHERE purpose IN ('PASSWORDLESS_TENANT', 'PASSWORDLESS_PLATFORM');

DROP INDEX IF EXISTS auth_webauthn_passwordless_active_idx;

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_context_check;

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_purpose_check;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_purpose_check
  CHECK (purpose IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP'));

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_context_check
  CHECK (
    (purpose = 'REGISTRATION' AND parent_mfa_token_hash IS NULL AND session_id IS NULL)
    OR
    (purpose = 'AUTHENTICATION' AND parent_mfa_token_hash IS NOT NULL AND session_id IS NULL)
    OR
    (purpose = 'STEP_UP' AND parent_mfa_token_hash IS NULL AND session_id IS NOT NULL)
  );

ALTER TABLE auth_webauthn_challenges
  ALTER COLUMN user_id SET NOT NULL;

COMMIT;

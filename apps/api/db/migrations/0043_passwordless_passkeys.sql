BEGIN;

ALTER TABLE auth_webauthn_challenges
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_purpose_check;

ALTER TABLE auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS auth_webauthn_challenges_context_check;

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_purpose_check
  CHECK (
    purpose IN (
      'REGISTRATION',
      'AUTHENTICATION',
      'STEP_UP',
      'PASSWORDLESS_TENANT',
      'PASSWORDLESS_PLATFORM'
    )
  );

ALTER TABLE auth_webauthn_challenges
  ADD CONSTRAINT auth_webauthn_challenges_context_check
  CHECK (
    (
      purpose = 'REGISTRATION'
      AND user_id IS NOT NULL
      AND parent_mfa_token_hash IS NULL
      AND session_id IS NULL
    )
    OR
    (
      purpose = 'AUTHENTICATION'
      AND user_id IS NOT NULL
      AND parent_mfa_token_hash IS NOT NULL
      AND session_id IS NULL
    )
    OR
    (
      purpose = 'STEP_UP'
      AND user_id IS NOT NULL
      AND parent_mfa_token_hash IS NULL
      AND session_id IS NOT NULL
    )
    OR
    (
      purpose IN ('PASSWORDLESS_TENANT', 'PASSWORDLESS_PLATFORM')
      AND user_id IS NULL
      AND parent_mfa_token_hash IS NULL
      AND session_id IS NULL
    )
  );

CREATE INDEX auth_webauthn_passwordless_active_idx
  ON auth_webauthn_challenges (purpose, expires_at, created_at DESC)
  WHERE consumed_at IS NULL
    AND purpose IN ('PASSWORDLESS_TENANT', 'PASSWORDLESS_PLATFORM');

COMMIT;

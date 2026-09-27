BEGIN;

CREATE TABLE user_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}'::text[],
  device_type text NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  name text NOT NULL DEFAULT 'Passkey',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX user_passkeys_user_idx
  ON user_passkeys (user_id, created_at DESC);

CREATE TABLE auth_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge text NOT NULL UNIQUE,
  purpose text NOT NULL
    CHECK (purpose IN ('REGISTRATION', 'AUTHENTICATION')),
  parent_mfa_token_hash bytea,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (purpose = 'REGISTRATION' AND parent_mfa_token_hash IS NULL)
    OR
    (purpose = 'AUTHENTICATION' AND parent_mfa_token_hash IS NOT NULL)
  )
);

CREATE INDEX auth_webauthn_challenges_user_active_idx
  ON auth_webauthn_challenges (user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

COMMIT;

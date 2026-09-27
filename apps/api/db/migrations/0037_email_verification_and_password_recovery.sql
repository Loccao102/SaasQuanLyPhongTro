BEGIN;

ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz;

UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at);

CREATE TABLE auth_pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  organization_name text NOT NULL,
  password_hash bytea NOT NULL,
  password_salt bytea NOT NULL,
  scrypt_n integer NOT NULL CHECK (scrypt_n >= 16384),
  scrypt_r integer NOT NULL CHECK (scrypt_r > 0),
  scrypt_p integer NOT NULL CHECK (scrypt_p > 0),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX auth_pending_registrations_email_ci_uidx
  ON auth_pending_registrations (lower(email));

CREATE INDEX auth_pending_registrations_expiry_idx
  ON auth_pending_registrations (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE auth_password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX auth_password_reset_tokens_user_idx
  ON auth_password_reset_tokens (user_id, created_at DESC);

CREATE INDEX auth_password_reset_tokens_expiry_idx
  ON auth_password_reset_tokens (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;

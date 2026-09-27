BEGIN;

DROP TRIGGER IF EXISTS organization_memberships_enforce_user_tenant
  ON organization_memberships;
DROP FUNCTION IF EXISTS enforce_tenant_membership_user_scope();

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_tenant_scope_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_tenant_scope_check
  CHECK (
    (account_type = 'PLATFORM' AND organization_id IS NULL)
    OR
    (account_type = 'TENANT' AND organization_id IS NOT NULL)
  );

COMMIT;

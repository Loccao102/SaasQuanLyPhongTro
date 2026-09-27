BEGIN;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_tenant_scope_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_tenant_scope_check
  CHECK (
    (account_type = 'PLATFORM' AND organization_id IS NULL)
    OR account_type = 'TENANT'
  );

CREATE OR REPLACE FUNCTION enforce_tenant_membership_user_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  user_account_type text;
  user_organization_id uuid;
BEGIN
  SELECT account_type, organization_id
    INTO user_account_type, user_organization_id
  FROM users
  WHERE id = NEW.user_id
  FOR UPDATE;

  IF user_account_type IS NULL THEN
    RAISE EXCEPTION 'Membership user does not exist.';
  END IF;

  IF user_account_type <> 'TENANT' THEN
    RAISE EXCEPTION 'Platform account cannot receive a tenant membership.';
  END IF;

  IF user_organization_id IS NULL THEN
    UPDATE users
    SET organization_id = NEW.organization_id,
        updated_at = now()
    WHERE id = NEW.user_id;
  ELSIF user_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Tenant account is already bound to another organization.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS organization_memberships_enforce_user_tenant
  ON organization_memberships;

CREATE TRIGGER organization_memberships_enforce_user_tenant
BEFORE INSERT OR UPDATE OF organization_id, user_id
ON organization_memberships
FOR EACH ROW
EXECUTE FUNCTION enforce_tenant_membership_user_scope();

COMMIT;

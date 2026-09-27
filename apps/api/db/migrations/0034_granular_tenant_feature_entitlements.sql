BEGIN;

ALTER TABLE organization_entitlement_overrides
  DROP CONSTRAINT IF EXISTS organization_entitlement_overrides_entitlement_key_check;

ALTER TABLE organization_entitlement_overrides
  ADD CONSTRAINT organization_entitlement_overrides_entitlement_key_check
  CHECK (entitlement_key IN (
    'room_limit',
    'staff_limit',
    'automation_actions_monthly',
    'properties',
    'leases',
    'metering',
    'pricing',
    'billing',
    'payments',
    'credit_balance',
    'finances',
    'maintenance',
    'notifications',
    'reports',
    'team_management',
    'advanced_reports',
    'audit_log'
  ));

UPDATE saas_plan_versions
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'pricing', true,
  'credit_balance', true,
  'finances', true
);

COMMIT;

BEGIN;

DROP TABLE IF EXISTS platform_command_receipts;
DROP TABLE IF EXISTS platform_audit_events;
DROP TABLE IF EXISTS organization_entitlement_overrides;
DROP TABLE IF EXISTS organization_subscriptions;

ALTER TABLE IF EXISTS saas_plans
  DROP CONSTRAINT IF EXISTS saas_plans_current_version_fk;

DROP TABLE IF EXISTS saas_plan_versions;
DROP TABLE IF EXISTS saas_plans;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS platform_operators;

COMMIT;

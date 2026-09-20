BEGIN;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS membership_scopes;
DROP TABLE IF EXISTS property_operational_groups;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS floors;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS operational_groups;
DROP TABLE IF EXISTS administrative_areas;
DROP TABLE IF EXISTS organization_memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS users;

COMMIT;

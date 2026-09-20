# Implementation Slice 0002 — Identity & Property Foundation

## Architecture preflight

Owning modules:
- Identity & Access: users, organization memberships, roles, permissions, scopes.
- Organizations: tenant account boundary.
- Properties: administrative areas, operational groups, properties, floors, rooms.
- Audit infrastructure: durable audit-event storage prepared for sensitive mutations.

Tenant boundary:
- users are global identities;
- administrative areas are shared reference data;
- organization memberships and all operational/property aggregates are organization-scoped;
- composite organization foreign keys reject several classes of cross-tenant references at DB level.

Idempotency:
- this slice introduces no retryable command endpoint yet;
- idempotency keys will be required when write APIs are added.

Audit:
- audit_events table is created now;
- mutation services that change permissions, pricing, contracts, readings or money must append audit events when introduced.

Failure behavior:
- authorization returns false for inactive memberships, missing permissions, wrong tenant or out-of-scope resources;
- DB constraints reject cross-organization property/floor/room/group relationships.

## Authorization model

```text
Membership ACTIVE
  AND organization matches
  AND role grants Permission
  AND MembershipScope covers resource
  => authorized
```

Initial scopes:
- ORGANIZATION
- OPERATIONAL_GROUP
- PROPERTY

Initial roles:
- OWNER
- ADMIN
- MANAGER
- STAFF
- ACCOUNTANT
- VIEWER

Business code consumes permissions, not hard-coded role checks.

## Property model

```text
AdministrativeArea (shared tree)
  -> Property (organization-owned)
      -> Floor
          -> Room

Organization
  -> OperationalGroup
      <-> Property
```

Room occupancy is deliberately not stored here. Occupancy will be derived from active Lease state in the Leasing slice.

## Migration notes

Forward:
- apply `0001_identity_property_foundation.sql` to a clean PostgreSQL database.

Rollback:
- `0001_identity_property_foundation.down.sql` drops only objects introduced by this initial migration;
- the rollback is intended for development/bootstrap before production data exists.

Before production deployment, migrations become forward-only operationally and destructive rollback is replaced by corrective migrations/backups.

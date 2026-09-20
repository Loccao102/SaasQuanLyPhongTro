# ADR-0004: Membership Permissions with Resource Scopes

- Status: Accepted
- Date: 2026-09-21

## Context

A user can participate in multiple landlord organizations and may only operate a subset of properties or operational groups inside one organization. A role alone cannot represent both capability and geographic/operational scope.

## Decision

Authorization is modeled as:

```text
User
  -> OrganizationMembership
      -> Role -> Permissions
      -> MembershipScope[]
```

Scopes supported initially:
- ORGANIZATION;
- OPERATIONAL_GROUP;
- PROPERTY.

A request is authorized only when:
- membership is ACTIVE;
- membership organization matches the resource organization;
- role grants the requested permission;
- at least one scope covers the resource.

Tenant isolation is additionally reinforced by composite `organization_id` foreign keys for tenant-owned references where practical.

## Consequences

Positive:
- supports staff/manager assignment without creating many bespoke roles;
- role definitions remain understandable;
- tenant boundary is explicit in both application and database layers;
- future custom roles can evolve without changing resource scoping.

Constraints:
- API handlers must resolve a trustworthy ResourceContext before authorization;
- frontend visibility is never the authorization boundary;
- role changes and scope changes require audit events.

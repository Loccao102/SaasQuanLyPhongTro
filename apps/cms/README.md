# PropOps CMS

Internal SaaS control surface.

## Local setup

Apply migrations in order:

```bash
psql "$DATABASE_URL" -f apps/api/db/migrations/0001_identity_property_foundation.sql
psql "$DATABASE_URL" -f apps/api/db/migrations/0002_cms_commercial_foundation.sql
psql "$DATABASE_URL" -f apps/api/db/seeds/cms_dev_operator.sql
```

Configure the API server:

```text
DATABASE_URL=postgresql://propops:propops@localhost:5432/propops
CMS_DEV_USER_ID=00000000-0000-0000-0000-000000000901
```

Configure the CMS frontend when the API is not same-origin:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
```

Run:

```bash
pnpm dev:api
pnpm dev:cms
```

CMS default port is `3003`.

## Scope

Connected to PostgreSQL/API now:
- system settings;
- SaaS plan versions and limits;
- organization/room/staff inspection;
- platform audit;
- dashboard counts.

Explicitly pending:
- real login/session middleware (local dev uses a server-side dev principal);
- durable Jobs/Queue integration;
- Loki/observability integration;
- subscription billing/payment lifecycle;
- entitlement overrides and quota reservation.

CMS does not own a separate business database and browser code never selects the platform user id.

# Habi Control Plane

Internal SaaS control surface.

## Local setup

From the repository root:

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:setup
```

Then either run the entire Habi development stack:

```bash
pnpm dev
```

or only the API and CMS:

```bash
pnpm dev:api
pnpm dev:cms
```

For a Docker-only full stack:

```bash
pnpm docker:up
```

CMS default port is `3003`. API default port is `4000`.

See [Local Development Runtime](../../docs/operations/LOCAL_DEVELOPMENT.md) for Docker, local and hybrid modes.

## Scope

Connected to PostgreSQL/API now:
- system settings;
- SaaS plan versions and limits;
- organization/room/staff inspection;
- entitlement overrides;
- subscription provision + lifecycle transitions + immediate plan changes;
- SaaS subscription billing periods, invoices, balances and manual payments;
- provider payment REVIEW_REQUIRED reconciliation queue;
- audited/idempotent append-only payment allocation;
- durable notification Jobs/Queue inspection + audited manual retry;
- automation quota reservation/consumption inspection;
- platform audit;
- dashboard counts.

Explicitly pending:
- real login/session middleware (local dev uses a server-side dev principal);
- Loki/observability integration;
- provider-specific payment webhook adapter/signature verification;
- self-service paid upgrade/downgrade checkout;
- scheduled future plan changes;
- production notification provider adapter (Playwright Zalo or official API).

CMS does not own a separate business database and browser code never selects the platform user id.

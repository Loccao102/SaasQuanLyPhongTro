# PropOps CMS

Internal SaaS control surface.

## Run

```bash
pnpm install
pnpm dev:cms
```

Default port: `3003`.

## Scope

CMS can configure system settings and plans, inspect organizations, inspect/retry jobs, and read technical logs/audit.

CMS does not own a separate business database. Production data and mutations must come from the modular-monolith API via `/api/cms/*`.

The current slice uses mock data/local React state while Identity, persistence and domain modules are still being implemented.

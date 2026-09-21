# Local Development Runtime

Habi supports two first-class development modes:

1. **Full Docker**: Docker Compose runs PostgreSQL, Redis, database setup, API, all frontend apps and all worker roles.
2. **Local Node**: Node/pnpm runs the application processes directly. PostgreSQL and Redis may run natively or through Docker.

Both modes use the same ports and environment contract.

## Ports

| Service | URL / port |
| --- | --- |
| Admin | http://localhost:3000 |
| Staff PWA | http://localhost:3001 |
| Public Invoice | http://localhost:3002 |
| CMS | http://localhost:3003 |
| API | http://localhost:4000/api |
| API health | http://localhost:4000/api/health |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

## Full Docker

Docker is the only host dependency required for this mode.

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

If pnpm is installed on the host, the equivalent shortcut is:

```bash
pnpm docker:up
```

The stack waits for PostgreSQL, applies pending SQL migrations once, applies the idempotent CMS development seed, starts the API, waits for API health, then starts the web apps and isolated worker processes.

Stop the stack:

```bash
pnpm docker:down
```

Remove PostgreSQL/Redis development data and recreate from zero:

```bash
pnpm docker:reset
pnpm docker:up
```

Use reset when migrating from an older local Docker volume that predates the `schema_migrations` tracking table.

## Local Node / pnpm

Requirements:

- Node.js >= 22.13
- pnpm 12.4.1
- PostgreSQL
- Redis when a feature requires it

Install dependencies and create local configuration:

```bash
corepack enable
corepack prepare pnpm@12.4.1 --activate
pnpm install
cp .env.example .env
```

You can run PostgreSQL and Redis natively. Or use Docker for infrastructure only:

```bash
pnpm infra:up
```

Prepare the database:

```bash
pnpm db:setup
```

Start API, Admin, Staff, Public Invoice, CMS and the three worker roles in one terminal:

```bash
pnpm dev
```

The local orchestrator loads the root `.env`, starts each process separately and prefixes logs with the service name.

Individual root commands remain available:

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:staff
pnpm dev:public
pnpm dev:cms
pnpm dev:worker
```

For a specific worker role, export `WORKER_ROLE` before running `pnpm dev:worker`. The full `pnpm dev` command already starts NOTIFICATION, BILLING and BILLING_WEBHOOK as separate processes.

## Environment boundary

The browser-facing API URL is always:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
```

Local Node processes use host service addresses:

```text
DATABASE_URL=postgresql://propops:propops@localhost:5432/propops
REDIS_URL=redis://localhost:6379
INTERNAL_API_BASE_URL=http://localhost:4000/api
```

Docker Compose overrides those internal addresses with Compose DNS names:

```text
postgres:5432
redis:6379
api:4000
```

This keeps application code environment-agnostic and avoids Docker-specific logic inside business modules.

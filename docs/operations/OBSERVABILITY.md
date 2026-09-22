# Production observability v1

Habi exposes a first-party operational metrics surface without changing PostgreSQL as the source of truth.

## Endpoints

### Prometheus scrape

```text
GET /api/metrics
Authorization: Bearer <OBSERVABILITY_METRICS_TOKEN>
```

The metrics token is separate from the worker token and must be at least 16 characters.

The endpoint exposes Prometheus text format and intentionally excludes raw provider payloads, payment metadata, idempotency keys and secrets.

### Worker heartbeat

```text
POST /api/internal/observability/heartbeat
Authorization: Bearer <INTERNAL_WORKER_TOKEN>
```

All worker roles report into the same runtime heartbeat table:

- `NOTIFICATION`
- `BILLING`
- `BILLING_WEBHOOK`

Each worker reports its own stale threshold so deployments with different poll/sweep intervals do not share an unsafe hardcoded timeout.

## Metrics currently exposed

API process metrics:

- request count;
- 5xx count;
- request latency histogram;
- max observed request latency.

PostgreSQL process metrics:

- configured pool max;
- current total/idle/waiting connections;
- DatabaseService query count;
- transaction count;
- slow-operation count using `DB_SLOW_OPERATION_THRESHOLD_MS`.

Worker metrics:

- instances by role/status;
- stale workers by role;
- oldest heartbeat age by role.

Notification operations:

- pending jobs;
- failed jobs;
- manual-review jobs;
- oldest pending age.

Billing webhook operations:

- received;
- processing;
- review-required;
- failed;
- stale processing;
- oldest backlog age.

The CMS Observability surface also shows 24-hour notification/webhook operational counts.

## Important limitations

This is the production observability hook, not the final monitoring stack.

The following still need deployment-level integration:

- Prometheus-compatible scraper/storage;
- Grafana dashboards;
- alert routing;
- centralized structured logs;
- infrastructure/node/container metrics;
- PostgreSQL server-level slow-query extension/collector;
- PWA sync telemetry;
- backup monitoring.

Database operation timing currently measures queries issued through `DatabaseService.query` and whole transaction durations through `DatabaseService.withTransaction`. It does not claim to replace PostgreSQL-native query monitoring such as `pg_stat_statements`.

## Suggested initial alerts

Configure externally once metrics are scraped:

- `habi_worker_stale{role="BILLING"} > 0`;
- `habi_worker_stale{role="BILLING_WEBHOOK"} > 0`;
- `habi_billing_webhook_stale_processing > 0`;
- `habi_db_pool_connections{state="waiting"} > 0` sustained;
- increasing `habi_api_http_errors_total`;
- notification pending age above the operational SLA.

Alert thresholds should be tuned from pilot measurements rather than guessed into business code.

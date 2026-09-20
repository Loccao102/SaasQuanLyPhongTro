# CMS / Internal Control Surface

Status: architecture baseline.

## Definition

CMS trong Prop-Ops là **internal control surface** để đội vận hành SaaS:

- CONFIGURE;
- INSPECT;
- OPERATE;
- AUDIT.

CMS không phải content CMS và không phải một business system sở hữu dữ liệu riêng.

## Ownership

SaaS backend/domain vẫn sở hữu:
- organizations;
- users;
- properties/rooms;
- leases/residents;
- metering;
- invoices/payments;
- subscriptions;
- usage/entitlements;
- notification jobs.

CMS chỉ đọc hoặc gửi command qua API/application service.

## Runtime boundary

Recommended shape:

```text
SaaS UI -----------\
Staff PWA ----------+--> Backend Modular Monolith --> PostgreSQL
Public Invoice -----/
CMS ----------------/
                         |
                         +--> Redis / Queue / Workers
                         +--> Observability
```

CMS là frontend surface riêng và có permission riêng, nhưng không có business DB riêng.

## API boundary

Use a dedicated namespace:

```text
/api/app/*
/api/cms/*
/api/public/*
/api/internal/*
```

CMS routes may perform cross-organization reads only after server-side platform authorization.

## CMS capabilities

### Settings
- registration;
- maintenance mode;
- trial/grace policy;
- automation retry/concurrency;
- provider enablement;
- templates and other safe system config.

### Plans & limits
- price configuration;
- room/staff limits;
- automation quota;
- feature availability.

Values are data/config, not scattered hard-coded conditionals.

### Organization inspection
- plan/subscription status;
- current usage vs effective entitlement;
- activity/health summaries;
- safe support actions.

### Operations
- queue/job status;
- retry/manual review;
- provider health;
- pause/resume where supported.

### Audit
- who changed what;
- before/after;
- reason;
- timestamp;
- target.

## Security invariants

- UI visibility is not authorization.
- CMS never writes PostgreSQL directly.
- No generic SQL editor.
- No raw secret viewer.
- Sensitive mutations require platform permission.
- Settings/plan/subscription/manual retry changes require audit.
- Idempotency is required for retryable commands.
- Cross-organization access exists only for explicitly authorized platform principals.

## Logs

Business audit and technical logs are different.

Business/platform audit belongs in structured durable storage.

Technical logs (HTTP errors, worker crashes, provider timeouts, Redis disconnects, slow queries) should be emitted as structured logs to observability infrastructure. CMS may query an observability API, but technical logs are not business source of truth.

## Database

There is no separate CMS business database.

CMS-owned UI preferences may use client storage or a small platform settings table if needed, but business state remains in SaaS-owned modules/tables.

## Failure behavior

- CMS action errors must say whether mutation committed.
- Bulk operations return per-item results and partial success.
- Provider/worker failure does not corrupt core state.
- UNKNOWN notification state is never converted to success.

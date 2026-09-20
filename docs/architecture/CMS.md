# CMS / Internal Control Surface

Status: architecture baseline.

## Definition

CMS trong Prop-Ops là internal control surface để đội vận hành SaaS: CONFIGURE, INSPECT, OPERATE và AUDIT.

CMS không phải content CMS và không phải một business system sở hữu dữ liệu riêng.

## Ownership

SaaS backend/domain vẫn sở hữu organizations, users, properties/rooms, leases/residents, metering, invoices/payments, subscriptions, usage/entitlements và notification jobs.

CMS chỉ đọc hoặc gửi command qua API/application service.

## Runtime boundary

```text
CMS ----------------\
Admin Web -----------\
Staff PWA ------------+--> Backend Modular Monolith --> PostgreSQL
Public Invoice -------/
                          |
                          +--> Redis / Queue / Workers
                          +--> Observability
```

CMS là frontend surface riêng và có platform permission riêng, nhưng không có business DB riêng.

## API boundary

```text
/api/app/*
/api/cms/*
/api/public/*
/api/internal/*
```

CMS routes may perform cross-organization reads only after server-side platform authorization.

## Capabilities

- Settings: registration, maintenance, trial/grace, automation/provider config.
- Plans & limits: prices, room/staff limits, automation quota, feature availability.
- Organization inspection: subscription, usage vs entitlement, health summaries.
- Operations: job status, retry/manual review, provider health.
- Logs/Audit: technical logs via observability; durable structured platform audit.

## Security invariants

- UI visibility is not authorization.
- CMS never writes PostgreSQL directly.
- No generic SQL editor or raw secret viewer.
- Sensitive mutations require platform permission + audit reason.
- Retryable commands require idempotency keys.
- Cross-organization access exists only for explicitly authorized platform principals.

## Failure behavior

Action errors state whether mutation committed. Bulk operations return per-item results/partial success. Provider failure does not corrupt core state. UNKNOWN notification state is never converted to success.

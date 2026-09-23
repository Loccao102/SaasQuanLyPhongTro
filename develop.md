# develop.md — Development Backlog & Expansion Directions

> Status source for work that is **not finished yet**, production gaps, and expansion directions.
>
> Last reviewed: 2026-09-23
>
> Architecture baseline: modular monolith + isolated workers + PostgreSQL source of truth.
>
> This file should be updated whenever a development slice materially changes the status below.

---

## 1. Current baseline

The project already has working foundations for:

- multi-tenant Organization / Property / Room modeling;
- lease lifecycle and termination orchestration;
- CMS / Control Plane backed by real API contracts;
- platform roles, permissions, idempotent commands and audit logs;
- versioned SaaS plans, prices and entitlements;
- subscription lifecycle and commercial write enforcement;
- durable notification jobs / attempts / worker boundary;
- notification provider operations, pause/resume and worker health;
- SaaS subscription billing ledger:
  - Invoice;
  - PaymentTransaction;
  - PaymentAllocation;
  - partial payments;
  - derived balance / overdue;
  - PAST_DUE / GRACE_PERIOD / SUSPENDED;
- billing scheduler worker;
- scheduled cancellation-at-period-end;
- raw payment webhook inbox;
- replay-safe webhook processing;
- CMS billing reconciliation queue;
- provider payment search backend with cursor pagination;
- isolated worker roles:
  - NOTIFICATION;
  - BILLING;
  - BILLING_WEBHOOK.

Current development branch:

```text
feature/admin-lease-operations
```

At the time this file was created, the latest completed CI checkpoint was green.

---

# 2. P0 — Production blockers

These items should be resolved before calling the SaaS production-ready for real paying organizations.

## 2.1 Real authentication and session management

Current platform authorization/domain permission foundations exist, but full production authentication/session UX is not complete.

Required:

- login/logout flows;
- secure cookie/session or token strategy;
- password reset / account recovery;
- session revocation;
- operator session handling for CMS;
- tenant/admin session handling for SaaS app;
- route protection on frontend and backend;
- CSRF strategy where applicable;
- brute-force / rate-limit controls;
- optional MFA for platform administrators;
- secure user invitation/activation flow.

Do not use development identity shortcuts in production.

### Expansion

Later:

- SSO/SAML/OIDC for Enterprise;
- Google/Microsoft login;
- organization-level SSO policy;
- device/session management.

---

## 2.2 Production payment provider

The provider-neutral payment architecture is implemented, but a real production provider adapter is still required.

Primary candidate:

```text
SePay
```

Required:

- public provider-specific webhook endpoint;
- production signature/authentication verification;
- exact raw-body capture;
- provider event ID extraction;
- deterministic transaction normalization;
- provider transaction ID mapping;
- transaction timestamp mapping;
- amount mapping;
- paymentReference extraction;
- sandbox/test fixtures;
- provider replay tests;
- provider outage/degraded behavior;
- operational documentation;
- secret rotation.

Rules:

- provider code stays in Integrations/Edge;
- Commercial/Billing must remain provider-neutral;
- low-confidence matching must remain REVIEW_REQUIRED;
- webhook retry must never duplicate financial effects.

### Expansion

Potential providers:

- SePay;
- banking direct API;
- VNPay;
- MoMo;
- ZaloPay;
- manual bank statement import.

Avoid adding multiple providers until the first production integration is stable.

---

## 2.3 Refund, overpayment and credit-balance policy

The current ledger intentionally refuses unsafe financial behavior instead of silently creating credits.

Still undefined:

- customer overpays invoice;
- payment belongs to organization but no current invoice can accept all money;
- refund full payment;
- refund partial payment;
- reverse an incorrect allocation;
- carry organization credit to future period;
- credit expiry;
- refund fees;
- provider refund reconciliation.

Need a proper model instead of editing/deleting existing financial rows.

Likely future concepts:

```text
CreditBalance
CreditMovement
Refund
RefundAllocation
AllocationReversal
```

Financial history must remain append-only.

---

## 2.4 Backup / restore / disaster recovery

Required before production:

- automated PostgreSQL backup;
- encrypted backup storage;
- retention policy;
- restore drill;
- restore verification;
- RPO/RTO target;
- secrets backup/rotation policy;
- worker recovery runbook;
- disaster recovery documentation.

A backup that has never been restored successfully is not considered complete.

---

## 2.5 Production observability and alerting

Operational observability v1 is implemented in application code:

- authenticated Prometheus-compatible `/api/metrics` endpoint;
- API request count, 5xx count and latency histogram;
- PostgreSQL pool total/idle/waiting/max metrics;
- DatabaseService query/transaction timing and slow-operation counters;
- unified runtime heartbeat for NOTIFICATION / BILLING / BILLING_WEBHOOK workers;
- worker stale thresholds derived from each runtime cadence;
- notification queue depth and oldest pending age;
- notification sent/failed/manual-review 24h snapshot for CMS;
- billing webhook backlog, stale PROCESSING and oldest backlog age;
- billing worker sweep duration/processed/failed metadata;
- CMS Observability surface backed by live DB/runtime data;
- dedicated `OBSERVABILITY_METRICS_TOKEN`;
- operations runbook in `docs/operations/OBSERVABILITY.md`.

Still required before production:

- deploy a Prometheus-compatible scraper/storage;
- Grafana dashboards;
- alert rules/routing;
- PostgreSQL-native server/query metrics such as `pg_stat_statements`;
- infrastructure/container/storage metrics;
- provider-specific error-rate metrics where useful;
- PWA sync failure telemetry once the PWA exists;
- backup monitoring;
- centralized structured logs/error tracking.

Required alerts still need infrastructure wiring:

- billing scheduler not running;
- payment webhook backlog;
- stale workers;
- repeated provider auth/session failure;
- excessive failed notification jobs;
- database storage/connection pressure;
- backup failure.

### Expansion

Later add:

- OpenTelemetry;
- distributed traces;
- Sentry/error tracking;
- alert routing to Telegram/Slack/email.

---

# 3. P1 — Core rental SaaS product work

The Control Plane/Billing platform foundation is ahead of the daily rental-management product. These areas need continued development.

## 3.1 Main SaaS Admin Web

The landlord/staff-facing app is now moving from prototype/demo data to live tenant data.

Implemented first live asset slice:

- tenant principal guard backed by active organization membership + membership scopes;
- fail-closed production behavior when authenticated tenant identity/workspace is absent;
- property.read enforcement server-side;
- scoped asset overview from PostgreSQL;
- Property -> Floor -> Room hierarchy;
- room occupancy derived from current ACTIVE / TERMINATION_SCHEDULED lease;
- property detail and room detail routes;
- current lease financial snapshot on room detail;
- responsive loading / empty / error states;
- Admin navigation now links to the live asset workflow.

Implemented management slice:

- property create/edit/deactivate commands;
- floor create/edit/deactivate commands;
- room create/edit/deactivate commands;
- property.manage scope enforcement;
- organization-scope requirement for creating a new property;
- room-limit enforcement through the existing commercial policy;
- idempotent client-generated UUID create commands;
- audit events for property/floor/room mutations;
- safe deactivation invariants for active leases and active child resources;
- Admin forms wired to the live command API.

Still required:

- organization/workspace switcher and real session integration;
- administrative areas;
- operational groups;
- residents;
- deeper leases/contracts;
- deposits;
- meter readings;
- billing cycles;
- invoices;
- receivables/debt;
- payment status;
- notifications;
- income/expense;
- reporting;
- staff/member management;
- integrations;
- subscription/account settings.

The CMS must not become a substitute for the tenant-facing Admin Web.

---

## 3.2 Contract / lease management completion

The transactional lifecycle foundation is now exposed through the tenant Admin Web.

Implemented live operational slice:

- tenant-scoped lease list and detail from PostgreSQL;
- property-scope lease.read / lease.manage / lease.terminate enforcement;
- create Lease DRAFT with a primary Resident in one transaction;
- client UUID + persisted idempotency receipt for draft creation;
- explicit DRAFT -> ACTIVE activation flow;
- explicit DRAFT -> CANCELLED flow;
- ACTIVE -> TERMINATION_SCHEDULED scheduling;
- cancellation of scheduled termination back to ACTIVE;
- readiness-aware final termination;
- database-backed single-current-lease-per-room guard with conflict mapping;
- audit timeline surfaced in Admin;
- live termination readiness display;
- explicit confirmation UI for activation, draft cancellation and termination;
- retry-safe command keys preserved across recoverable frontend failures.

Still required:

- select/reuse an existing Resident instead of always creating a new Resident;
- multiple lease parties;
- edit DRAFT contractual terms before activation;
- deposit payment/settlement integration;
- utility pricing snapshot/reference;
- attachments;
- contract PDF/document output;
- amendment workflow;
- renewal workflow;
- final meter reading integration;
- final invoice/debt integration;
- deposit settlement integration;
- create replacement/new contract directly from terminated lease/room.

Important invariant:

```text
A room must not silently have multiple conflicting active leases.
```

### Expansion

Later:

- e-signature;
- contract templates;
- document versioning;
- resident portal acknowledgment.

---

## 3.3 Metering and Staff PWA

The core metering backend foundation now implements:

- organization/room-scoped electricity and water meters;
- one active meter per room/type;
- append-only dated meter readings;
- client UUID idempotency for meter creation/readings;
- validation against both previous and later readings for safe backfill;
- exact 3-decimal reading storage/usage calculation;
- tenant/property permission enforcement;
- audited meter and reading writes;
- billing usage resolution with explicit missing-meter / missing-reading states.

The Staff offline-first workflow is still required:

- property/room checklist;
- fast electricity input;
- fast water input;
- previous reading display;
- anomaly warning;
- IndexedDB local persistence;
- sync queue;
- offline status;
- conflict resolution;
- admin progress tracking;
- assignment of staff to areas/properties;
- retry failed sync.

Local states:

```text
DRAFT
PENDING_SYNC
SYNCING
SYNCED
CONFLICT
FAILED
```

### Expansion

Later:

- camera meter capture;
- OCR as assisted input only;
- anomaly scoring;
- bluetooth/IoT meter integrations.

---

## 3.4 Tenant rent/utility invoicing

Important distinction:

```text
SaaS subscription invoice != renter/room invoice
```

SaaS subscription billing is already implemented substantially.

The renter billing foundation now implements:

- property-scoped billing cycle create/list/detail;
- OPEN -> FINALIZED cycle lifecycle;
- retry-safe DRAFT generation/refresh per cycle/lease;
- full-period base-rent snapshots from Lease;
- effective-range property pricing policies;
- electricity and water usage from meter-reading deltas;
- fixed service-fee invoice lines;
- exact 3-decimal quantity × integer-VND calculation;
- pricing, meter, previous/current reading snapshots on generated invoice lines;
- explicit READY / REVIEW_REQUIRED calculation state;
- safe re-generation of system-owned DRAFT lines after missing data is supplied;
- finalization blocking while pricing/meter data still requires review;
- DRAFT -> ISSUED renter invoice transition;
- immutable issued invoice/line snapshot direction;
- integer VND totals;
- billing.read / billing.manage scope enforcement;
- audit for cycle creation, pricing, metering, draft generation and finalization;
- safe blocking of partial-period leases until proration/manual adjustment policy exists;
- Admin billing cycle + invoice detail UI with calculation-readiness feedback;
- Admin property pricing setup with explicit financial review/confirmation and read-only policy history.

Still required for the full rental invoice domain:

- Staff offline meter-entry/sync UX;
- WATER_PER_PERSON and other non-meter utility policy variants when demanded;
- discounts;
- adjustments;
- previous debt carry-forward policy;
- tenant payment allocation;
- receipt history;
- void/correction policy.

Financial rows should use integer VND values.

---

## 3.5 Public renter invoice page

Required zero-install mobile page:

- secure opaque/public token;
- invoice breakdown;
- period;
- room/property;
- previous/current meter readings;
- usage;
- fees;
- debt;
- paid/remaining;
- VietQR;
- bank deeplink;
- payment status;
- contact/support information.

### Realtime

Add SSE for payment status update:

```text
bank payment
 -> webhook
 -> allocation
 -> invoice changes
 -> SSE event
 -> public invoice UI updates
```

PostgreSQL remains source of truth.

---

## 3.6 Income / expense and landlord accounting view

Need a pragmatic operational accounting module, not full ERP initially.

Required:

- income entries;
- expense categories;
- property-linked expense;
- recurring expenses;
- receipt attachment;
- cash/bank classification;
- monthly summary;
- property profitability;
- outstanding receivables;
- export.

### Expansion

Later:

- owner settlement;
- multi-owner property split;
- accounting software integration;
- tax reporting export.

---

# 4. P1 — CMS / Control Plane unfinished work

## 4.1 Provider transaction search UI

Implemented:

- search form;
- payment UUID / provider transaction ID / paymentReference search;
- provider filter;
- reconciliation-status filter;
- cursor-based result pagination + Load more;
- clear filters;
- transaction detail drill-down;
- allocation-history view;
- safe copy payment ID/reference actions;
- safe API DTOs that omit payment metadata/idempotency key;
- linked webhook history without raw payload/headers;
- permission-aware audit history.

Remaining follow-up:

- direct organization/invoice deep links once CMS routing/detail routes exist.

Do not expose sensitive raw provider payload by default.

---

## 4.2 Billing transaction detail / reconciliation history

Implemented in the provider-payment detail drill-down:

- safe PaymentTransaction identity/status/provider fields;
- current assigned organization id/name when organization inspection is available;
- amount / allocated / remaining-unallocated amounts;
- every PaymentAllocation;
- target invoice/reference/status/balance;
- allocation actor id or system auto-match;
- allocation reason and timestamps;
- relevant audit events when `platform.audit.read` is present;
- linked webhook events with safe operational fields.

Implemented follow-up:

- direct organization detail route;
- direct SaaS invoice detail route;
- provider-payment allocation deep links to organization + invoice;
- allocation actor display-name resolution on invoice detail where permitted.

Implemented operational follow-up:

- live runtime/API/DB/worker/queue/webhook observability in the CMS;
- authenticated Prometheus-compatible metrics hook;
- billing scheduler and webhook worker heartbeat visibility.

Implemented follow-up:

- global ID/reference search across organization / provider payment / SaaS invoice / notification job;
- permission-scoped search so a role cannot use global search to bypass organization, billing or jobs read permissions;
- exact ID/reference ranking before prefix/contains matches;
- direct organization and SaaS invoice deep-links plus safe copy-ID actions.

Still required:

- richer reconciliation bulk/filter workflows only if real operations require them.

### Expansion

Later:

- allocation reversal;
- refund history;
- credit movement history.

---

## 4.3 Plan/subscription future changes

Immediate plan change exists.

Still required:

- downgrade effective at period end;
- upgrade proration policy;
- scheduled future plan change;
- cancel scheduled plan change;
- price grandfathering UI;
- plan version history UI;
- organization-specific negotiated pricing;
- coupons/promotions if actually needed.

Do not implement complex coupon engines before real product demand.

---

## 4.4 Subscription self-service

Current Control Plane can manage subscriptions, but tenant organizations still need self-service.

Required:

- current plan page;
- current usage;
- room/staff/automation quotas;
- upgrade;
- downgrade;
- cancel at period end;
- undo cancellation;
- billing history;
- payment instructions;
- outstanding SaaS invoice;
- download billing document if applicable.

Upgrade must require explicit user confirmation.

---

## 4.5 CMS search and navigation at scale

Implemented:

- organization search by name / slug / owner / UUID;
- filters by plan / subscription status / organization status / over-limit / delinquency;
- cursor pagination;
- direct `/organizations/:organizationId` detail route;
- preserved list filters in URL;
- organization detail commercial/billing/usage snapshot;
- CMS navigation routes directly to the scalable directory.

Implemented:

- global ID/reference search across organization/payment/invoice/job;
- query length and per-scope result bounds;
- permission-aware database scopes;
- topbar shortcut and dedicated `/search` route;
- direct organization/invoice navigation from results.

Already completed by follow-up slices:

- direct invoice detail route;
- allocation actor display-name resolution where permitted;
- operational observability surface.

Avoid rendering thousands of organizations in one page.

---

# 5. P1 — Notification automation unfinished work

## 5.1 Production Playwright Zalo adapter

The durable notification foundation now has a concrete Playwright Zalo edge adapter baseline.

Implemented:

- isolated worker-only ZALO_PLAYWRIGHT provider;
- Playwright pinned to a matching dedicated browser image;
- encrypted AES-256-GCM browser storage state;
- exclusive session-file lock to avoid concurrent account use;
- operator bootstrap command for interactive login/session refresh;
- authenticated-session / CAPTCHA detection;
- exact display-name recipient verification before send;
- post-send message-bubble verification before SENT_CONFIRMED;
- safe UNKNOWN / MANUAL_REVIEW outcomes;
- provider auto-pause for auth/session/CAPTCHA/UI-breakage failures;
- no cookies/session tokens returned to API logs/evidence;
- selector overrides through deployment environment;
- persistent Docker session volume for the notification worker.

Still required before calling this production-stable:

- validate/tune selectors against the actual deployed Zalo Web account/UI;
- session rotation runbook and operational ownership;
- evidence screenshot policy with explicit PII retention/redaction rules if screenshots are enabled;
- provider UI regression smoke test against a non-production test account;
- hard deployment limit of one active worker per Zalo account/session;
- test real logout, CAPTCHA, network interruption and ambiguous post-send cases;
- confirm Zalo platform policy/terms for the intended operational use.

Never retry blindly after ambiguous post-send state.

### Expansion

Later:

- official Zalo API;
- SMS provider;
- email;
- Telegram;
- multi-channel fallback rules.

---

## 5.2 Notification campaign operations

Still useful:

- pause campaign;
- resume campaign;
- cancel pending campaign;
- bulk manual-review actions;
- bulk retry with safeguards;
- recipient filtering;
- campaign detail;
- progress metrics;
- export failures;
- re-send policy;
- template management.

---

## 5.3 Provider credential/session management

Required:

- encrypted secret storage;
- key rotation;
- provider credential health;
- expiration timestamps;
- operator access control;
- audit on secret replacement;
- never expose secrets in CMS responses/logs.

---

# 6. P1 — Commercial entitlement and quota expansion

## 6.1 Automation quota ledger maturation

Current durable notification flow already reserves/consumes automation quota.

Need further work for product maturity:

- monthly quota reset;
- billing-period-aware usage;
- add-on quota packs;
- expiration rules;
- usage history;
- CMS adjustment;
- tenant-facing usage UI;
- alert at 70/90/100%;
- concurrent reservation safeguards across more automation types.

Possible generalized model:

```text
UsageLedger
UsageReservation
UsageCommit
UsageRefund
UsageAdjustment
```

---

## 6.2 Add-ons

Potential add-ons:

- automation action packs;
- extra staff seats;
- extra storage;
- API access;
- branding;
- premium integrations.

Do not hardcode add-ons into plan conditionals.

Use entitlement keys and versioned commercial configuration.

---

# 7. P2 — Reporting and analytics

Required eventually:

- occupancy rate;
- vacancy;
- move-in/move-out;
- rent collected;
- debt aging;
- utility consumption;
- revenue by property;
- expenses by property;
- net operating income;
- payment collection rate;
- notification delivery rate;
- staff meter-reading progress.

### Scale direction

Start with indexed PostgreSQL queries.

Only add:

- cached projections;
- materialized views;
- reporting replicas;
- warehouse/OLAP

after measurement proves they are needed.

---

# 8. P2 — Import / export

## Excel import

Required imports:

- property/room;
- resident;
- lease;
- opening meter reading;
- opening debt;
- pricing configuration.

Need:

- dry-run;
- validation report;
- row-level errors;
- resumable/background processing;
- idempotency;
- audit;
- downloadable error file.

## Export

Required:

- rooms;
- residents;
- contracts;
- invoices;
- debt;
- payments;
- meter readings;
- reports;
- audit where permitted.

Large export must run as a worker job, not synchronous HTTP.

---

# 9. P2 — Files and document storage

Need an object/file storage strategy for:

- contract attachments;
- resident documents;
- meter photos;
- expense receipts;
- generated invoices;
- generated contracts;
- imports/exports.

Requirements:

- organization ownership;
- access authorization;
- signed download URLs;
- retention policy;
- malware/file validation;
- metadata;
- soft-delete/retention behavior.

Do not store large binary files directly in PostgreSQL unless there is a measured reason.

---

# 10. P2 — Security hardening

Required:

- full authorization review;
- tenant isolation tests for every major module;
- secret scanning;
- dependency vulnerability scanning;
- rate limiting;
- webhook abuse protection;
- secure headers;
- CSP where applicable;
- upload validation;
- PII access controls;
- audit log retention;
- operator privilege review;
- production debug/log redaction;
- database least-privilege roles.

### Expansion

Later:

- security event dashboard;
- IP/device history;
- Enterprise audit export;
- anomaly detection.

---

# 11. P2 — Data retention and privacy

Policies still need definition:

- cancelled organization retention;
- resident PII retention;
- contract retention;
- invoice/payment retention;
- webhook raw-body retention;
- notification evidence retention;
- browser/session secret retention;
- audit log retention;
- organization export before deletion;
- hard-delete/anonymization process.

Financial/audit records may require different treatment from ordinary operational data.

Legal requirements must be researched before production policy is finalized.

---

# 12. P2 — Performance / scale testing

Target progression:

```text
0–5k rooms
5k–50k rooms
>50k rooms
```

Required tests:

- large organization room list;
- organization search;
- meter-cycle close;
- bulk invoice generation;
- notification campaigns;
- payment webhook bursts;
- billing scheduler;
- CMS audit/search;
- Excel imports.

Measure before adding:

- partitioning;
- read replicas;
- sharding;
- service extraction.

Do not introduce microservices because the pilot has 200 rooms.

---

# 13. P2 — Background job platform

Notification/Billing workers exist, but more workloads will need durable job semantics.

Future job types:

- renter invoice generation;
- Excel imports;
- Excel exports;
- PDF generation;
- aggregate refresh;
- large report generation;
- reminder campaigns;
- cleanup/retention tasks.

Long-term direction:

```text
Job
JobAttempt
JobLease/Claim
Retry policy
Dead-letter / manual review
Operational metrics
```

Do not run large batches inside request/response handlers.

---

# 14. P3 — Geography and organization expansion

Current model should continue scaling by:

```text
Organization
  -> Administrative area
  -> Operational group
  -> Property
  -> Floor
  -> Room
```

Expansion directions:

- province/city;
- ward/commune;
- operational regions independent from government boundaries;
- staff assignment by region/property;
- dashboards by geography;
- room/property counts as query/projection, not manually maintained counters.

Keep administrative geography configurable/data-driven because Vietnam administrative structures can change.

---

# 15. P3 — Multi-owner / property-management business model

Possible later expansion beyond a landlord managing only their own rooms:

- property owner;
- property manager;
- owner portfolio;
- management contracts;
- management fee;
- revenue share;
- owner statements;
- delegated permissions;
- owner portal.

This is a separate business capability and should not be forced into the current basic Organization membership model until needed.

---

# 16. P3 — Resident portal

Possible resident-facing account:

- active lease;
- invoices;
- payment history;
- meter readings;
- maintenance request;
- contract documents;
- notices;
- move-out request;
- profile/contact update.

Start with public invoice zero-install flow first. A resident login should be added only when recurring self-service value justifies account complexity.

---

# 17. P3 — Maintenance / incident management

Future module:

- maintenance ticket;
- room/property;
- category;
- priority;
- photos;
- assignee;
- vendor;
- cost;
- status;
- SLA;
- resident notification.

Potential lifecycle:

```text
OPEN
ASSIGNED
IN_PROGRESS
WAITING
RESOLVED
CLOSED
```

---

# 18. P3 — API / integrations platform

Future Enterprise capability:

- API keys / OAuth;
- scoped permissions;
- organization API access;
- webhooks for SaaS events;
- integration logs;
- retries;
- secret rotation;
- usage limits.

Potential outbound events:

- lease activated;
- lease terminated;
- renter invoice issued;
- payment received;
- invoice paid;
- room occupancy changed.

Do not expose internal database IDs/contracts blindly as a public API before versioning strategy exists.

---

# 19. External/legal work requiring fresh research

These topics are intentionally not hardcoded yet because regulations/providers can change.

Before implementation, research current Vietnam requirements for:

- electronic invoices;
- tax documents;
- VAT/tax treatment;
- payment intermediaries;
- personal data/privacy obligations;
- retention requirements;
- e-signatures/e-contract validity;
- SMS/Zalo messaging policy;
- banking/payment webhook requirements.

Keep legal/tax documents separate from internal SaaS subscription invoice concepts unless requirements explicitly align.

---

# 20. Known documentation cleanup

Some older implementation slices describe earlier states and contain pending items that later slices have already completed.

Examples:

- older commercial slice still says subscription billing/payment records are pending;
- older notification slice still describes provider-health work as pending even though later slice implements it;
- roadmap phases do not fully reflect the newer SaaS Control Plane billing work.

Required maintenance:

- keep historical implementation slices as historical records;
- update `docs/ROADMAP.md` to current product phases;
- point contributors to this `develop.md` for active backlog;
- avoid editing historical ADR decisions merely to make them look current.

---

# 21. Recommended execution order

## Phase A — Finish operational Control Plane

1. Provider Transaction Search UI.
2. Provider transaction detail/allocation history.
3. Organization detail/search/pagination.
4. Billing/reconciliation operational polish.
5. Production observability hooks.

## Phase B — Complete core rental workflow

1. Admin Web property/room UX.
2. Full lease/contract workflow.
3. Billing cycles.
4. Staff Metering PWA offline-first.
5. Rental invoice generation.
6. Public invoice page.
7. VietQR/payment status.

## Phase C — Production integrations

1. Production payment provider (initially likely SePay).
2. Production Playwright Zalo transition adapter.
3. Secret/session management.
4. Provider monitoring/runbooks.

## Phase D — Self-service SaaS commercial flow

1. Tenant subscription page.
2. Usage/quota page.
3. Paid upgrade.
4. End-of-period downgrade.
5. End-of-period cancel.
6. Billing history/payment instructions.
7. Add-ons.

## Phase E — Hardening / pilot

1. Authentication/session hardening.
2. Backup/restore drill.
3. Security review.
4. Load test.
5. Monitoring + alerting.
6. Incident/DR runbook.
7. Real pilot migration/import.
8. Pilot feedback fixes.

## Phase F — Expansion

After pilot evidence:

- reporting;
- income/expense;
- maintenance;
- resident portal;
- owner portal;
- API/integrations;
- official messaging providers;
- advanced analytics.

---

# 22. Definition of Done for future development

A feature is **not done** merely because a page or database table exists.

## Domain/backend

Must have, where applicable:

- tenant/organization boundary;
- application/domain invariant;
- authorization;
- idempotency for retryable commands;
- optimistic/concurrency protection where necessary;
- explicit failure states;
- audit for sensitive/financial/admin mutations;
- indexes for expected query pattern.

## Financial features

Must additionally have:

- integer money representation;
- append-only financial history;
- replay safety;
- no silent overpayment/loss;
- allocation/reconciliation traceability;
- integration tests.

## Async jobs/integrations

Must additionally have:

- durable state;
- retries/backoff;
- idempotent effect;
- timeout/stale recovery;
- manual review for ambiguous state;
- operational visibility.

## Frontend

Must additionally have:

- loading state;
- empty state;
- error state;
- permission-aware state;
- conflict state where relevant;
- responsive behavior;
- keyboard/accessibility basics;
- design-system reuse.

## Production

Must additionally have:

- tests;
- CI green;
- migration + rollback considered;
- docs updated;
- observability;
- operational recovery path.

---

# 23. Architectural directions to preserve

Unless measurements or requirements prove otherwise:

- keep the backend as a **modular monolith**;
- keep CMS as a separate product surface, not a separate source-of-truth business backend;
- PostgreSQL remains source of truth;
- workers do not write PostgreSQL directly;
- provider integrations stay at the Edge;
- API remains stateless;
- scale workers independently by workload;
- use cursor pagination for large operational lists;
- avoid manually maintained aggregate counts where source entities can derive them;
- existing data must never be deleted simply because a customer downgrades;
- suspended/cancelled customers must retain safe access/export according to policy;
- do not auto-upgrade/auto-charge without explicit commercial consent;
- do not split microservices until profiling/operational evidence justifies it.

---

# 24. Near-term next task

The compact Control Plane foundation is substantially complete and the Admin Web now has its first live tenant-scoped asset read workflow.

Current most immediate unfinished product task:

```text
Admin Web -> finish lease dependencies, then production notification/payment integrations
```

Property/floor/room management and the live Lease operational workflow are implemented. Manual audited termination-readiness override is available as an interim bridge until Metering + renter Billing/Payment + deposit modules own those readiness updates. Resident reuse, scoped resident search, draft term editing with optimistic version checks, and DRAFT-only CO_TENANT/OCCUPANT management are implemented. Renter billing now snapshots rent + metered electricity/water + fixed service pricing into review-gated DRAFT invoices. Next complete the Staff offline meter-entry/sync workflow, then tenant payment allocation and the production payment provider integration. After that move to messaging/notification operations and user-group/member management.

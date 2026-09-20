# CMS Product Workflows

## Surface and persona

Surface: internal CMS, desktop/tablet-first.

Primary personas:
- PLATFORM_ADMIN;
- SUPPORT_OPERATOR;
- OPS_OPERATOR;
- READ_ONLY_AUDITOR.

Permissions are server-side capabilities, not only UI roles.

## Primary job

Quickly understand system/customer state, safely change configuration, recover operational failures, and leave an audit trail.

## Navigation baseline

1. Tổng quan
2. Cấu hình
3. Gói & giới hạn
4. Organizations
5. Jobs / Queue
6. Audit log

## Settings workflow

Entry: Cấu hình.

Happy path:
1. find setting;
2. inspect current value and description;
3. edit value;
4. review system impact;
5. provide reason;
6. submit;
7. show success receipt/audit id.

Critical states:
- invalid value;
- permission denied;
- conflict/version changed;
- server error before commit;
- server error after commit with receipt lookup.

## Plan workflow

Plan changes must show:
- current value;
- proposed value;
- affected dimension;
- whether existing subscriptions keep price/version;
- effective date policy;
- reason.

Do not implement pricing changes as an unqualified generic CRUD Save action.

## Organization inspection

Information hierarchy:
1. identity;
2. subscription status;
3. current plan;
4. usage vs limits;
5. operational alerts;
6. recent audit/activity.

Over-limit:
- do not delete existing rooms;
- clearly show usage > limit;
- explain which resource growth is blocked.

## Operational jobs

Rows show:
- job id;
- organization;
- kind/provider;
- status;
- attempt count;
- last error.

Manual retry:
1. open job;
2. verify retryable state;
3. show prior attempts/error;
4. require reason;
5. queue retry with idempotency key;
6. show resulting job status.

Bulk retry must show target count and a partial-success result summary.

## Audit

Audit entries show:
- actor;
- action;
- target;
- before/after or meaningful detail;
- reason;
- timestamp.

Audit is read-only from CMS.

## Required view states

Every production data view handles:
- loading;
- empty;
- loaded;
- permission denied;
- network/server error;
- validation error;
- success;
- partial success for bulk operations.

## Responsive

Desktop/tablet uses sidebar + tables + detail panels.

On narrow screens:
- navigation becomes horizontally scrollable/collapsible;
- tables can scroll inside their container;
- primary action remains reachable;
- confirmation dialogs fit viewport without horizontal page overflow.

## Accessibility

- persistent form labels;
- visible keyboard focus;
- semantic buttons/inputs;
- dialog semantics for confirmations;
- status uses text, not color alone;
- validation errors associated with fields.

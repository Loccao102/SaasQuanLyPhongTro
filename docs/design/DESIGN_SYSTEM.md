# Product Design System — Baseline

Status: baseline rules for future implementation.

## Product surfaces

### Admin Web

Primary environment: desktop/tablet.

Goals:
- dense but readable operational information;
- fast drill-down: area -> property -> floor -> room -> lease/invoice;
- explicit permissions and scope;
- safe financial/destructive workflows;
- bulk operations with clear selection and result summaries.

### Staff PWA

Primary environment: mobile, one-hand use, intermittent connectivity.

Goals:
- minimum taps;
- thumb-friendly controls;
- auto-focus/next behavior for meter entry;
- persistent offline drafts;
- obvious sync state;
- recovery from duplicate/conflict/reconnect conditions.

### Public Invoice

Primary environment: mobile browser, zero-install, no account required.

Goals:
- load fast;
- immediately show amount/status/context;
- one obvious payment action;
- minimal personal data;
- no app-install dependency;
- realtime payment feedback when available.

## Interaction principles

1. One primary action per screen or workflow step.
2. Destructive actions use precise verbs: "Chấm dứt hợp đồng", "Hủy hóa đơn", not generic "Xác nhận".
3. Financial/destructive confirmations show the object, effective date, and consequences.
4. Do not expose actions the user lacks permission for when that would create confusion; server authorization remains mandatory.
5. Preserve user input across recoverable failures.
6. Empty states explain what the user can do next.
7. Errors state what failed, whether data was saved, and the recovery action.
8. Success feedback must be observable; never rely on a button disappearing as confirmation.
9. Status uses text/icon plus color, never color alone.
10. Bulk operations always show target count before execution and a result summary afterward.

## Required states

Every meaningful data screen/workflow considers:
- initial loading;
- empty;
- loaded;
- validation error;
- permission denied;
- network/server error;
- success;
- partial success for bulk actions;
- retry/recovery.

Offline-capable Staff flows additionally require:
- offline;
- pending sync;
- syncing;
- synced;
- conflict;
- failed sync.

## Forms

- Labels remain visible; placeholders are not labels.
- Validate as early as useful without interrupting fast entry.
- Financial amounts display formatted VND but submit exact integer/fixed-decimal values.
- Dates must be unambiguous.
- Preserve unsaved form state when recoverable.
- Use explicit domain action names for submit buttons.

## Destructive and financial workflows

Examples: terminate lease, settle deposit, issue/cancel invoice, manual payment allocation, pricing changes.

Required:
- permission check;
- summary of impact;
- effective date;
- irreversible/secondary effects;
- explicit confirmation;
- audit trail;
- post-action receipt/status.

A complex domain transition should use a guided workflow/wizard rather than a generic delete button.

## Lease-specific baseline

"Chấm dứt hợp đồng" is a domain transition, not record deletion.

Expected flow:
1. effective move-out date;
2. final meter-reading readiness;
3. outstanding-charge/final-invoice readiness;
4. deposit settlement readiness;
5. consequence review;
6. explicit final action;
7. resulting room availability and audit event.

A termination workflow must show unresolved readiness and block finalization while required dependencies remain pending.

Creating the next lease must not erase or mutate the historical lease.

## Responsive behavior

- Define breakpoints by layout need, not device brand.
- Admin tables may become cards/detail drill-down on narrow screens.
- Staff interactions are designed mobile-first, not desktop layouts collapsed to mobile.
- Public Invoice must work comfortably on common phone widths without horizontal scrolling.

## Accessibility

Baseline:
- semantic controls;
- programmatic labels;
- visible focus;
- keyboard reachability where applicable;
- errors associated with fields;
- sufficient contrast;
- minimum comfortable touch targets;
- reduced-motion-friendly behavior for nonessential animation.

## Reuse

Implemented shared primitives in `@propops/ui`:
- PageHeader;
- StatusBadge;
- MetricCard;
- MoneyDisplay;
- SectionHeader;
- ProgressBar.

Before creating a new UI pattern, also check whether an existing pattern can serve:
- DataTable/List;
- EmptyState;
- ErrorState;
- ConfirmAction;
- DateDisplay;
- PermissionGate;
- SyncStatus;
- Stepper/Workflow;
- AuditTimeline.

When a new reusable pattern is introduced, update this document or component documentation in the same change.

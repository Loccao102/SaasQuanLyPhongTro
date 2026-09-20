# Implementation Slice 0001 — Foundation & UI Shells

Status: Foundation prototype. Business data remains mocked until domain slices are connected.

## Architecture preflight

Owning concerns:
- repository/tooling foundation;
- shared UI design primitives;
- API health module.

No financial mutation or tenant-owned persistence is introduced in this slice.

Tenant boundary:
- UI displays the concept of a current organization/scope only;
- no authorization claim is made yet;
- real server-side membership/permission enforcement belongs to the Identity slice.

Idempotency/audit:
- not applicable to the static UI shell or read-only health endpoint.

Failure behavior:
- CI verifies lint, typecheck and production builds;
- frontend mock content explicitly states that real data/auth is not connected.

## Product design preflight

### Admin
- Surface: Admin Web.
- Persona/role: OWNER / ADMIN.
- Scope: organization-wide.
- Job-to-be-done: understand operational health immediately and drill into areas needing attention.
- Main flow: dashboard -> metric/cycle/attention -> area drill-down placeholder.
- Critical states: loaded prototype; data loading/error/empty states will be implemented when API data is introduced.
- Destructive/financial risk: none in this slice.
- Responsive: desktop/tablet first; sidebar collapses into horizontal navigation on narrow screens.
- Reuse: MetricCard, StatusBadge, SectionHeader, ProgressBar.

### Staff
- Surface: Staff PWA.
- Persona/role: STAFF.
- Scope: assigned property/building.
- Job-to-be-done: resume meter-entry work with minimum taps.
- Main flow: assignment -> progress -> next room -> meter fields -> save/next placeholder.
- Offline: UX reserves sync state but deliberately does not pretend persistence exists. IndexedDB and durable sync arrive with Metering.
- Responsive: mobile-first.

### Public Invoice
- Surface: Public Invoice.
- Persona: renter/resident with valid public invoice link.
- Job-to-be-done: understand amount due and reach payment action immediately.
- Main flow: invoice summary -> line items -> VietQR/deeplink placeholder.
- Security: no real public token or resident data is wired in this slice.
- Financial risk: payment action is non-functional and clearly marked as prototype.
- Responsive: mobile-first.

## Stack decision

- pnpm workspace;
- Next.js for Admin, Staff and Public Invoice;
- NestJS for the modular-monolith API;
- TypeScript throughout;
- PostgreSQL + Redis prepared via Docker Compose.

See ADR-0003.

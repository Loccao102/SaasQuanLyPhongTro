# Public Invoice Web Instructions

These instructions apply to all work under `apps/public-invoice/`.

Before any user-facing design or implementation:
1. MUST read `../../.agents/skills/product-design/SKILL.md`.
2. MUST read `../../.agents/skills/frontend-pwa/SKILL.md`.
3. MUST read `../../docs/design/DESIGN_SYSTEM.md`.
4. MUST read billing/payment/security docs relevant to the change.

Public Invoice rules:
- Zero-install: no app download requirement.
- No account/login required for the normal invoice-view/payment journey.
- Mobile-first and fast-loading.
- Minimize exposed resident/financial data to what is necessary.
- One clear primary payment action.
- Payment state must be explicit: unpaid, partial, processing if applicable, paid, error/retry.
- Public tokens and authorization are backend concerns; UI must never rely on hidden IDs for security.
- Avoid shipping Admin/Staff code or dependencies to this surface.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

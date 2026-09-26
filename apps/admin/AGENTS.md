# Admin Web Instructions

These instructions apply to all work under `apps/admin/`.

Before any user-facing design or implementation:
1. MUST read `../../.agents/skills/product-design/SKILL.md`.
2. MUST read `../../.agents/skills/frontend-pwa/SKILL.md`.
3. MUST read `../../docs/design/DESIGN_SYSTEM.md`.
4. MUST read the relevant domain skill/docs for the feature.

Admin UX rules:
- Optimize for desktop/tablet operational work.
- Design drill-down and bulk operations explicitly.
- Always model role, permission, and resource scope.
- Financial/destructive domain transitions require explicit impact review and confirmation.
- Do not implement lease termination, invoice cancellation, manual reconciliation, pricing changes, or permission changes as generic CRUD.
- Include loading, empty, error, partial-success, permission-denied, and success states where relevant.
- Reuse shared components/patterns before adding one-off UI.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

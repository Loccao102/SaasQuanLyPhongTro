# CMS / Internal Control Surface Instructions

These instructions apply to all work under `apps/cms/`.

Before user-facing design or implementation:
1. MUST read `../../.agents/skills/product-design/SKILL.md`.
2. MUST read `../../.agents/skills/frontend-pwa/SKILL.md`.
3. MUST read `../../docs/design/DESIGN_SYSTEM.md`.
4. MUST read `../../docs/design/CMS_WORKFLOWS.md`.
5. MUST read relevant architecture/security/domain docs.

CMS invariants:
- CMS is for CONFIGURE / INSPECT / OPERATE / AUDIT.
- CMS does not own SaaS business data and does not write PostgreSQL directly.
- All mutations go through backend application/domain services.
- Cross-organization access requires explicit platform permission server-side.
- Settings, plan/limit changes, retries and other operational mutations require an audit reason.
- Never add a generic DB editor, raw secret viewer, SQL console, or domain-validation bypass.
- Technical logs are read from observability integrations; logs are not business source of truth.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

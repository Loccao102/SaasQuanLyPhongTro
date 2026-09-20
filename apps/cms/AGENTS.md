# CMS / Internal Control Surface Instructions

Applies to all work under `apps/cms/`.

Before user-facing work:
1. Read `../../.agents/skills/product-design/SKILL.md`.
2. Read `../../.agents/skills/frontend-pwa/SKILL.md`.
3. Read `../../docs/design/DESIGN_SYSTEM.md`.
4. Read `../../docs/design/CMS_WORKFLOWS.md`.
5. Read relevant domain/security/operations docs.

CMS rules:
- CMS is an internal operator UI for CONFIGURE / INSPECT / OPERATE / AUDIT.
- CMS does not own SaaS business data and does not write PostgreSQL directly.
- All mutations go through server-side application/domain services.
- Cross-organization access requires explicit platform permission.
- Plan/settings/feature-flag changes, manual operational actions and retries require audit.
- Never add a generic DB editor, secret viewer, SQL console, or bypass around domain validation.
- Technical logs may be read from observability APIs; do not treat application logs as business source of truth.

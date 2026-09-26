# Staff PWA Instructions

These instructions apply to all work under `apps/staff/`.

Before any user-facing design or implementation:
1. MUST read `../../.agents/skills/product-design/SKILL.md`.
2. MUST read `../../.agents/skills/frontend-pwa/SKILL.md`.
3. MUST read `../../docs/design/DESIGN_SYSTEM.md`.
4. MUST read relevant metering/domain docs.

Staff UX rules:
- Mobile-first and thumb-first.
- Optimize for task speed in the field, not dashboard density.
- Offline behavior is part of the design, not a later enhancement.
- Never discard unsynced meter readings.
- Every write flow must define pending-sync, syncing, synced, conflict, and failed states where relevant.
- Keep input focus/next behavior deliberate for fast meter entry.
- Make the assigned operational scope obvious; staff should not browse unrelated properties by default.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

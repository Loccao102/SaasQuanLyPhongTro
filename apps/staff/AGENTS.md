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

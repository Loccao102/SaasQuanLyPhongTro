---
name: propops-frontend-pwa
description: Use when building the Admin Web, Staff PWA, or Public Invoice Web, especially mobile meter entry, offline sync, zero-install invoice UX, and realtime status.
---

1. Identify the surface: Admin, Staff, or Public Invoice. Do not mix their UX priorities.
2. Staff PWA is thumb-first and offline-first. Persist business drafts in IndexedDB.
3. Use client-generated UUID/idempotency keys for offline writes.
4. Never drop an unsynced reading after refresh/reconnect.
5. Surface sync status and conflicts explicitly.
6. Public Invoice requires no installation or account and must minimize exposed personal data.
7. Prefer SSE for one-way payment/progress updates.
8. Optimize initial load and avoid shipping Admin-only bundles to Public Invoice.
9. Provide accessible labels, keyboard behavior, loading/error/empty states.
10. Test offline -> reconnect -> duplicate retry -> conflict flows.

# Implementation Slice 0019 — Staff Auth + Offline Session

## Product design preflight

Surface:
- Staff PWA.

Persona:
- authenticated staff/member assigned to organization/property scope.

Primary job:
- sign in once while online, then continue assigned meter-entry work during connectivity loss without losing unsynced readings.

## Auth/offline state model

```text
LOADING
  -> AUTHENTICATED
  -> OFFLINE_AUTHENTICATED
  -> AUTHENTICATED after reconnect validation

AUTHENTICATED
  -> UNAUTHENTICATED on server 401/revocation/expiry

OFFLINE without a still-valid cached session
  -> UNAUTHENTICATED
```

Offline cached session:
- stores only user/profile, memberships, selected organization and server session expiry;
- never stores the raw HttpOnly session token;
- cannot detect server-side revocation until reconnect;
- is accepted only while the known session expiry is still in the future.

On reconnect the PWA must revalidate `/auth/me` before trusting server writes.

## Offline data ownership

New local meter readings include `actorUserId`.

IndexedDB queries require:
- actor user;
- organization;
- reading date.

Cached checklists are also keyed by:
- user;
- organization;
- reading date.

This prevents another Staff login on the same browser profile from accidentally syncing another user's queued readings under the wrong audit actor.

Pre-auth v1 offline rows/checklists are retained in IndexedDB but are intentionally not auto-attributed to a newly authenticated user. Before deploying this change to devices with real unsynced pre-auth pilot data, sync those devices first or build an explicit supervised recovery flow.

## Network behavior

When offline:
- authenticated cached session may continue to use cached checklist;
- new readings persist to IndexedDB;
- no sync is attempted;
- logout is disabled because the HttpOnly server session cannot be revoked offline.

When online:
- session is revalidated;
- 401 redirects to login;
- existing IndexedDB readings remain untouched;
- after the same user signs back in, their queued readings remain available.

## Transport

Staff browser defaults to same-origin `/api` and Next rewrites to `STAFF_API_PROXY_TARGET`.

Unsafe online writes echo the CSRF cookie in `X-CSRF-Token`. Organization selection is read from the authenticated workspace selector; backend membership/scope remains authoritative.

## Critical states

- login loading/error;
- first-login while offline blocked;
- online authenticated;
- offline authenticated;
- auth backend/network failure with valid cache fallback;
- expired/revoked session on reconnect;
- zero workspace;
- existing metering PENDING_SYNC / SYNCING / SYNCED / CONFLICT / FAILED remain unchanged.

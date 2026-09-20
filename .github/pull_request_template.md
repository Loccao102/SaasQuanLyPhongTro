## Summary

Describe what changes and why.

## Architecture preflight

- [ ] I read the relevant repository architecture skill/docs, or this change has no architectural/domain impact.
- [ ] The owning module/domain is clear.
- [ ] Tenant scope, idempotency, auditability, and failure behavior were considered where relevant.
- [ ] External-provider logic remains behind an adapter/edge boundary where relevant.

## Product design preflight

For user-facing changes:

- [ ] I read `.agents/skills/product-design/SKILL.md`.
- [ ] I read `.agents/skills/frontend-pwa/SKILL.md` and `docs/design/DESIGN_SYSTEM.md`.
- [ ] Surface and persona are identified: Admin / Staff / Public Invoice.
- [ ] Permission and resource scope are defined.
- [ ] Happy path plus loading/empty/error/success states are handled.
- [ ] Offline/reconnect/conflict behavior is defined where relevant.
- [ ] Destructive/financial consequences and confirmation are explicit where relevant.
- [ ] Responsive/mobile behavior is defined.
- [ ] Existing reusable patterns/components were checked before introducing new ones.

If this PR has no user-facing change, state that explicitly.

## Verification

Describe tests/checks performed.

## Docs / ADR

- [ ] Relevant docs were updated.
- [ ] ADR added/updated if this changes a durable architecture decision.
- [ ] No docs/ADR change is required; reason is stated above.

---
name: propops-product-design
description: Mandatory for any user-facing feature, screen, workflow, form, navigation, destructive/financial action, responsive behavior, or UX decision in this Prop-Ops SaaS. Read before proposing UI or writing frontend code.
---

# Product Design Skill

## Required sequence

1. Read the root `AGENTS.md`, the nearest nested `AGENTS.md`, and `docs/design/DESIGN_SYSTEM.md`.
2. Identify the product surface: Admin, Staff, or Public Invoice.
3. Identify the primary persona, role, permission, and resource scope.
4. State the user's primary job-to-be-done in one sentence.
5. Map the workflow before designing components:
   - entry point;
   - happy path;
   - alternate path;
   - validation;
   - loading;
   - empty;
   - error;
   - success;
   - retry/recovery.
6. For destructive, financial, lease/contract, deposit, payment, or permission changes:
   - identify irreversible effects;
   - require an explicit confirmation step;
   - show the exact consequence before confirmation;
   - ensure the backend action is auditable;
   - avoid ambiguous "Save" when a precise action label exists.
7. Design the information hierarchy before visual polish.
8. Prefer existing design-system components and patterns.
9. Define responsive behavior explicitly; do not assume desktop layouts shrink correctly.
10. Define accessibility behavior: labels, focus order, keyboard interaction, contrast, error association.
11. For Staff PWA, design offline/reconnect/conflict states before implementation.
12. For Public Invoice, minimize steps, data exposure, bundle size, and cognitive load.
13. Only after the workflow is coherent should implementation begin.

## Required design output before coding

For a meaningful user-facing feature, document at least:
- surface;
- persona/role;
- permission/scope;
- job-to-be-done;
- main flow;
- destructive/financial risks;
- critical UI states;
- mobile/responsive behavior;
- reusable components/patterns.

This can live in the task/PR/implementation notes; do not create a standalone document for every tiny change.

## Anti-patterns

Do not:
- start with a component tree before understanding the workflow;
- hide authorization problems with disabled buttons only;
- use modal dialogs for every interaction;
- silently discard unsaved/offline work;
- merge create/edit/terminate financial workflows into a generic CRUD form;
- use color as the only status signal;
- invent one-off patterns when a repository pattern already exists;
- optimize aesthetics at the cost of speed for Staff or clarity for Public Invoice.

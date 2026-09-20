# Prop-Ops CMS

Internal control surface for operating the SaaS.

This prototype intentionally has no framework dependency because the repository has not selected a frontend/backend runtime yet. It validates information architecture and workflows without locking the project into a stack prematurely.

## Scope

CMS can:
- configure system settings and feature flags;
- configure SaaS plans and limits;
- inspect organizations, subscriptions and usage;
- inspect/retry operational jobs;
- inspect platform audit events.

CMS does not:
- own business entities;
- maintain a separate business database;
- bypass SaaS domain services;
- expose raw secrets or a generic database editor.

## Run the prototype

Open `index.html` directly in a modern browser or serve this directory with any static HTTP server.

Data is mock data stored in browser `localStorage`. Server authorization, persistence and queue integration are documented contracts, not implemented by this prototype.

# Project rules for Claude Code

You are working on the **Warehouse Management Application** for iValue India. Read `SPEC.md` for the full functional and technical spec. Read this file before every task — it overrides general defaults.

---

## About this project

A multi-tenant web app that tracks IT assets through their lifecycle (receive → inspect → store → deploy → retrieve → dispose) for a third-party logistics warehouse operator. Every operational action posts a priced event to an append-only ledger; monthly invoices are derived from the ledger.

First client: **Esevel**. The system must be multi-tenant from day one because more clients will be added.

---

## Tech stack (locked — do not substitute without explicit approval)

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + TanStack Query + TanStack Table + React Router
- **Backend:** NestJS (TypeScript) + Prisma ORM
- **Database:** PostgreSQL 15
- **Queue:** Redis + BullMQ
- **Object storage:** S3-compatible (LocalStack locally, AWS S3 in prod)
- **Auth:** NestJS Passport, email + password, Argon2id for hashing, JWT sessions (12h expiry)
- **Testing:** Vitest (frontend), Jest (backend), Playwright (E2E)
- **Linting:** ESLint + Prettier (strict config; warnings break the build)

---

## Repository layout

Monorepo with pnpm workspaces:

```
/
├── apps/
│   ├── api/          NestJS backend
│   └── web/          React frontend
├── packages/
│   ├── shared/       Shared TypeScript types between api and web
│   └── eslint-config/  Shared lint config
├── infra/
│   ├── docker-compose.yml   Postgres + Redis + LocalStack for local dev
│   └── prisma/              Schema, migrations, seed scripts
├── docs/
│   └── adr/          Architecture decision records
├── CLAUDE.md
├── SPEC.md
└── README.md
```

Inside `apps/api`, organise by domain module (one folder per domain area): `auth/`, `clients/`, `users/`, `assets/`, `inbound/`, `inspections/`, `inventory/`, `rate-card/`, `ledger/`, `audit/`.

Inside `apps/web`, organise by feature: `features/auth/`, `features/clients/`, etc. Shared UI in `components/ui/` (shadcn), shared hooks in `hooks/`.

---

## Critical rules (non-negotiable)

1. **Multi-tenancy.** Every query that returns business data must filter by `client_id`. Implement this as a global Prisma middleware or a request-scoped guard on the API. Do not rely on the UI to hide cross-client data. A client_user role must never, by any code path, see another client's records.

2. **Append-only ledger.** The `events_ledger` table is immutable in the application. Never write code that updates or deletes ledger rows. Corrections are new rows with negative quantity referencing the original `event_id`. The Prisma client for `events_ledger` should expose only `create` and `findMany` from a dedicated service — no `update` or `delete` methods.

3. **Rate card versioning.** Editing a rate creates a new version with a new `effective_from`, never an update of the existing row. Events lookup the rate effective at `occurred_at`, never the current rate.

4. **Business-hours SLA.** SLA timers count Mon–Fri 09:00–18:00 IST only, excluding configured Indian public holidays. Use a `date-holidays` library or equivalent; store the holiday list in the database so admins can maintain it.

5. **Server-side authorisation everywhere.** Never trust the client. Every API endpoint validates: (a) the user is authenticated, (b) the user's role is allowed to perform the action, (c) if the resource belongs to a client, the user is allowed to see that client.

6. **No secrets in code or git.** All secrets in `.env` (which is `.gitignored`). Provide `.env.example` with placeholder values. Production secrets come from AWS Secrets Manager or equivalent.

7. **Money handled as integers.** Store all monetary amounts in paise (₹1 = 100 paise) as integers, never floats. Display formatting converts to rupees with proper Indian thousands grouping (₹42,750.00, not ₹42750.00).

8. **Time zone.** Server uses UTC internally; all UI display and business-day calculations use Asia/Kolkata. Store timestamps as `TIMESTAMPTZ` in Postgres.

---

## Coding conventions

- **TypeScript strict mode on.** No `any` without an explicit `// eslint-disable-next-line` and a comment explaining why.
- **No `console.log` in committed code.** Use the configured logger (NestJS `Logger` in api; `console` is fine during local dev only).
- **Error handling.** Throw typed exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, etc.) from NestJS, never bare `Error`. Frontend uses TanStack Query's error handling, surfaces user-friendly messages via a toast.
- **Naming.** Files `kebab-case.ts`. Classes `PascalCase`. Functions and variables `camelCase`. Database tables and columns `snake_case`.
- **Comments.** Explain *why*, not *what*. The code shows what; comments explain the reason a particular approach was chosen.
- **No dead code.** Delete it. Don't leave it commented out.

---

## How to add a feature (the workflow)

Every user story follows the same shape:

1. **Read the story** in `SPEC.md` (use the story ID, e.g. US-INB-02).
2. **Update the Prisma schema** if new tables/fields are needed; generate a migration with a descriptive name.
3. **Write the API module** — DTOs with class-validator, service, controller, guards.
4. **Write the unit tests** for the service (business logic) — aim for 70%+ coverage on logic modules.
5. **Write the API integration test** for the controller (happy path + at least one auth failure case).
6. **Build the UI** — page component, feature components, data fetching via TanStack Query.
7. **Write at least one Playwright E2E test** for the happy path of the story.
8. **Run** `pnpm lint && pnpm test && pnpm e2e` — all must pass.
9. **Verify acceptance criteria** from the story one by one.

If a story is ambiguous or the spec is silent on a detail, **stop and ask** before guessing.

---

## Definition of done

A story is done when:

- All acceptance criteria in SPEC.md pass.
- All tests pass (unit, integration, E2E).
- ESLint and Prettier pass with no warnings.
- The change is reviewed (by Divya or her delegate).
- The change is merged to `main` and deployed to staging.

---

## What to ask, what to assume

**Ask if:** the spec is silent or contradictory; the change affects auth, multi-tenancy, the ledger, or rate-card versioning; the change requires a new dependency.

**Assume sensibly if:** the choice is about file naming, internal component structure, choice of icon, copy wording (default to clear, plain English). State the assumption in the PR description.

**Never assume:** business rules. If you don't see the rule in SPEC.md, ask.

---

## Branching and commits

- `main` is always deployable.
- Feature branches: `feature/US-INB-02-receive-devices`.
- Commit messages: `feat(inbound): implement device receipt against expected delivery (US-INB-02)`.
- Pull requests reference the story ID in the title and link to SPEC.md section.

---

## When in doubt

Re-read this file and `SPEC.md`. If still in doubt, ask Divya. Do not silently guess on anything involving auth, money, multi-tenancy, or the ledger.

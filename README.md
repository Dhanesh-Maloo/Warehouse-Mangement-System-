# Warehouse Management Application

A multi-tenant web application for managing the end-to-end IT asset lifecycle (ingestion, deployment, retrieval, storage, disposal) for iValue India's fulfilment warehouse. First client: Esevel.

## Tech stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query
- **Backend:** NestJS (TypeScript) + Prisma ORM
- **Database:** PostgreSQL 15
- **Queue:** Redis + BullMQ
- **Storage:** S3-compatible object storage (LocalStack in dev, AWS S3 in prod)
- **Hosting target:** AWS Mumbai (ap-south-1)

## Documents you need to read first

- `CLAUDE.md` — the project rules. Claude Code reads this automatically on every task.
- `SPEC.md` — the full technical spec: data model, user stories with IDs, business rules.

## Prerequisites (set up once)

You need these installed on your machine:

1. **Node.js 20+** — [nodejs.org](https://nodejs.org) (pick the LTS version).
2. **Docker Desktop** — [docker.com](https://docker.com). For running Postgres and Redis locally without installing them.
3. **Git** — [git-scm.com](https://git-scm.com).
4. **VS Code** (recommended) — [code.visualstudio.com](https://code.visualstudio.com).
5. **Claude Code** — already installed in your Claude desktop app, accessible via the "Code" tab.

To verify everything is installed, open a terminal and run:

```bash
node --version    # Should show v20.x or higher
docker --version  # Should show something like 24.x
git --version     # Should show 2.x
```

## Project setup (first time only)

1. **Create a folder** for the project anywhere on your machine. Suggested: `~/Projects/warehouse-app`.
2. **Open the folder in VS Code.**
3. **Drop the three markdown files** (`README.md`, `CLAUDE.md`, `SPEC.md`) into that folder.
4. **Open Claude Code** in the Claude desktop app and point it at this folder.
5. **Paste the kickoff prompt** (in the chat with me — Divya) into Claude Code to scaffold the project. Claude Code will then create all the project files, set up Docker, install dependencies, and have a running auth flow in one go.

## Daily workflow with Claude Code

The key principle: **one user story at a time**. Don't ask Claude Code to "build the warehouse app." Ask it to "implement US-INB-02" (or whichever story you're on).

For each story:

1. Tell Claude Code: "Implement story US-XXX-NN from SPEC.md."
2. It will read the spec, write code, write tests, and run them.
3. Review the changes carefully (especially around auth, multi-tenancy, and billing).
4. Test it yourself in the browser.
5. Commit and move on.

If something looks wrong, push back. Claude Code responds well to specific feedback like "the SLA timer is counting non-business hours; fix per SPEC.md section 8.5."

## Build phases

- **Phase 1 (current):** Foundation — auth, clients, master data, rate card, inbound, inspection, inventory, event ledger. Esevel can log in and see their inventory.
- **Phase 2:** Deployment, retrieval, shipping.
- **Phase 3:** Billing engine, storage accrual, SLA dashboard, Zoho Books integration.
- **Phase 4:** Full client portal (request forms), disposal/ITAD with certificates, audit reports.

See `SPEC.md` for the full Phase 1 user story list.

## Important rules (also enforced in CLAUDE.md)

- **Multi-tenancy is non-negotiable.** Every query filters by `client_id`. Esevel must never see another client's data.
- **The event ledger is append-only.** Corrections are new entries, not edits.
- **Tests are part of "done", not optional.**
- **Never commit secrets.** All secrets go in `.env` (which is `.gitignored`).

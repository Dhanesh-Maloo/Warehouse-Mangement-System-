# Warehouse Management Application

A multi-tenant web application for managing the end-to-end IT asset lifecycle (ingestion, deployment, retrieval, storage, disposal) for iValue India's fulfilment warehouse. First client: Esevel.

## Tech stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query
- **Backend:** NestJS (TypeScript) + Prisma ORM
- **Database:** PostgreSQL 15
- **Storage:** S3-compatible object storage (LocalStack in dev, AWS S3 in prod)
- **Hosting target:** AWS Mumbai (ap-south-1)

---

## Getting started

### Prerequisites

Install these once before anything else:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 20+ | https://nodejs.org (pick LTS) |
| pnpm | latest | Run `npm install -g pnpm` after Node |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |

Make sure Docker Desktop is **open and running** before proceeding.

Verify your installs:

```bash
node --version    # v20.x or higher
pnpm --version    # 8.x or higher
docker --version  # 24.x or higher
```

---

### Step 1 — Extract and open the project

Extract the zip file to a folder on your machine, then open a terminal inside that folder.

---

### Step 2 — Install dependencies

```bash
pnpm install
```

---

### Step 3 — Configure environment

```bash
cp .env.example .env
```

Open `.env` in a text editor and set these two values:

```
JWT_SECRET=any-long-random-string-you-choose
SEED_ADMIN_PASSWORD=the-admin-password-you-want
```

Leave everything else as-is for local development.

---

### Step 4 — Start the database

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts Postgres in the background. Wait about 10 seconds for it to be ready.

---

### Step 5 — Run database migrations

```bash
pnpm db:migrate
```

This creates all the tables in the database.

---

### Step 6 — Seed demo data

```bash
pnpm db:seed
```

This loads sample data including locations, rate card, and demo user accounts.

---

### Step 7 — Start the app

```bash
pnpm dev
```

Open your browser and go to: **http://localhost:5173**

---

## Demo login credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@ivalueindia.com` | *(the `SEED_ADMIN_PASSWORD` you set in `.env`)* |
| Viewer | `viewer@esevel.com` | `Viewer@12345` |

---

## Stopping the app

Press `Ctrl+C` in the terminal to stop the app, then stop the database:

```bash
docker compose -f infra/docker-compose.yml down
```

---

## Resuming next time

You only need to run Steps 4 and 7 on subsequent starts — dependencies, migrations, and seed only need to run once.

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm dev
```

---

## Project structure

```
apps/api        NestJS backend (runs on port 3001)
apps/web        React frontend (runs on port 5173)
infra/prisma    Database schema, migrations, seed
packages/       Shared TypeScript types
```

---

## Important rules

- **Multi-tenancy is non-negotiable.** Every query filters by `client_id`. Esevel must never see another client's data.
- **The event ledger is append-only.** Corrections are new entries, not edits.
- **Never commit secrets.** All secrets go in `.env` (which is `.gitignored`).

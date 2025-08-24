# CI/CD Pipeline Health Dashboard (Node.js + React + PostgreSQL)

Monitor CI/CD executions (e.g., GitHub Actions/Jenkins) with real-time metrics, latest build status, and alerting.

## Features

- ✅ Success/Failure rate
- 🕒 Average build time
- 📌 Last build status
- 📣 Alerts via Slack webhook or Email (optional)
- 🖥️ React dashboard UI (auto-refresh) showing metrics + latest builds

## Architecture

- __API:__ Node.js (Express) + Prisma ORM
- __DB:__ PostgreSQL
- __Worker:__ Node.js simulation worker that ingests builds periodically (extensible to poll providers)
- __Frontend:__ React (Vite) served by Nginx (polls every 5s)
- __Alerting:__ Slack Incoming Webhook, optional SMTP email
- __Containers:__ Dockerized services orchestrated by `docker-compose`

Directory layout:

- `backend/` Node API (`src/index.js`, Prisma schema, alerting)
- `frontend/` React app built with Vite, served by Nginx
- `worker/` Node worker that POSTs builds to API

## Run with Docker

1. Optional alert envs:
   ```bash
   cp .env.example .env
   # Set SLACK_WEBHOOK_URL or SMTP_* vars if you want alerts delivered
   ```
2. Start the stack:
   ```bash
   docker compose up --build
   ```
   - Services:
     - API: http://localhost:8080
     - Web: http://localhost:3000
     - DB: localhost:5432 (user/pass/db: cicd)
   - Prisma migration: handled by `migrate` service (`prisma db push`).

The worker simulates builds every ~8s. Failures trigger alerts (Slack/email if configured; otherwise printed to logs).

## API Endpoints

- `GET /api/metrics` -> `{ success_rate, avg_build_time_sec, last_status, total_builds }`
- `GET /api/builds?limit=20` -> latest builds
- `POST /api/ingest` -> ingest a build (used by worker)

Example ingest payload:
```json
{
  "provider": "github",
  "pipeline": "owner/repo/main",
  "status": "success",
  "duration_sec": 120.5,
  "started_at": "2025-08-24T02:00:00Z",
  "finished_at": "2025-08-24T02:02:00Z",
  "commit": "a1b2c3d4",
  "branch": "main",
  "logs": "..."
}
```

## Extending to Real Providers

- __GitHub Actions:__ In `worker/src/index.js`, add polling for `/repos/{owner}/{repo}/actions/runs` with a GitHub Token.
- __Jenkins:__ Poll `/job/<name>/lastBuild/api/json`.
- Map provider run fields to the ingest payload and POST to `/api/ingest`.

## Local Dev (optional)

Run API only (needs Postgres running):
```bash
cd backend
export DATABASE_URL=postgresql://cicd:cicd@localhost:5432/cicd?schema=public
npx prisma generate
npx prisma db push
npm start
```
Run React dev server:
```bash
cd frontend
npm install
npm run dev
# VITE_API_BASE=http://localhost:8080 npm run dev  (to override API base)
```

## How AI Tools Were Used

- Scaffolded Node/React/Postgres services, Prisma schema, and Dockerfiles/compose.
- Example prompts:
  - "Create Express endpoints for metrics, list builds, ingest with Prisma."
  - "Add Slack webhook and SMTP alerting helpers."
  - "Build React dashboard polling /api/metrics every 5s."

## Assumptions & Learnings

- Near real-time via polling keeps design simple and robust.
- Prisma simplifies migrations (`db push`) for demo use; switch to migrations for prod.
- Web uses Vite+Nginx; API base defaults to `:8080`, configurable via `VITE_API_BASE`.

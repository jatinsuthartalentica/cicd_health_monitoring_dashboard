# 🔧 Source Code Repository

Public repo: https://github.com/jatinsuthartalentica/cicd_health_monitoring_dashboard

This repository contains the complete source code for the CI/CD pipeline health dashboard.

## Structure

- `backend/`
  - `src/index.js` — Express REST API (metrics, builds, branches, logs, repos CRUD, healthz)
  - `src/alerting.js` — Email alert integration (SMTP)
  - `prisma/schema.prisma` — DB schema (PostgreSQL)
  - `Dockerfile` — API container
  - `package.json`
- `frontend/`
  - `src/App.jsx`, `src/main.jsx` — React app (metrics, builds table, logs drawer)
  - `index.html`, `vite.config.js`
  - `nginx.conf` — Nginx config to serve the SPA
  - `Dockerfile` — Frontend container
- `worker/`
  - `src/index.js` — GitHub poller/ingestor (calls Backend `/api/ingest`)
  - `Dockerfile`
  - `package.json`
- `.env.example` — Environment variables template
- `docker-compose.yml` — Orchestration for `db`, `api`, `worker`, `web`
- `README.md` — Project overview & quickstart

## Components

- **Backend (Node.js + Express)**
  - Prisma ORM, Axios for GitHub API, AES-GCM encryption for per-repo tokens
  - Endpoints include:
    - `/api/metrics`, `/api/builds`, `/api/branches`
    - `/api/builds/:id/logs` (summary), `/api/builds/:id/logs/full?tail=N` (full job logs)
    - `/api/repos` CRUD and `/api/repos/:id/update`
    - `/api/internal/repos` (requires `X-Internal-Token`)
- **Frontend (React + Vite)**
  - Builds table with expandable logs panel (lazy load)
  - Uses `VITE_API_BASE` to target backend (e.g., `http://localhost:8080`)
- **Database (PostgreSQL)**
  - Tables: `Build`, `Repository` (via Prisma)
- **Alerting Service**
  - SMTP email on failed builds (debounced by `alertedAt` and age window)
- **Worker**
  - Polls GitHub Actions workflow runs and upserts into DB via API

## Local Development & Run

1) Copy `.env.example` to `.env` and set values
- Backend: `DATABASE_URL`, `ENCRYPTION_KEY`, SMTP vars, `INTERNAL_TOKEN`, `PORT=8080`
- Worker: `API_BASE=http://api:8080`, `INTERVAL_SECONDS`, `MODE=github`, `GITHUB_OWNER`, `GITHUB_REPO`, `INTERNAL_TOKEN`
- Frontend: build arg `VITE_API_BASE` is passed via compose (defaults to `http://localhost:8080`)

2) Start services
```
docker-compose up -d --build
```
- Web: http://localhost:3000
- API: http://localhost:8080 (health: `/healthz`)
- DB: localhost:5432 (user/db/pw: cicd)

3) Known compose v1 note
- If `web` recreate fails with `'ContainerConfig'` error, remove and recreate:
```
docker-compose rm -fs web && docker-compose up -d web
```

## Deployment

- Containers can be pushed to a registry and deployed to any Docker host.
- Frontend is static (Nginx) and points to API via `VITE_API_BASE`.
- Backend requires DB and SMTP configuration.

## GitHub Access & Logs

- For private repos or higher rate limits, add repo with token in UI (stored encrypted)
- Logs endpoints will use the stored token to fetch GitHub jobs and logs in real time.

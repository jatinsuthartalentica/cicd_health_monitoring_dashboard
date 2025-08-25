# 🧠 Requirement Analysis

This document expands the CI/CD dashboard requirements into a concrete plan.

## Key Features

- **Build Metrics Overview**
  - Success rate, average build time, last build status, total builds (`/api/metrics`).
- **Builds Table**
  - Paginated/latest builds with status, duration, commit, branch (`/api/builds`).
  - Filter by repo and branch. Branch list from `/api/branches`.
- **Execution Logs**
  - Inline logs summary per build (`/api/builds/:id/logs`).
  - Full job logs via GitHub, decompressed + tail support (`/api/builds/:id/logs/full?tail=N`).
  - Lazy loading on expansion and error/loader states.
- **Repo Management**
  - Add/update/delete monitored GitHub repos with optional per-repo token (`/api/repos`).
  - Manual refresh of runs for a repo (`POST /api/repos/:id/update`).
- **Alerting**
  - Email alert on failed builds (once per run, recent window).
- **Deployment**
  - Docker Compose services: `db`, `api`, `worker`, `web`.

## Tech Choices

- **Frontend**: React + Vite (no heavy UI libs), Nginx static host. Env: `VITE_API_BASE`.
- **Backend**: Node.js + Express, Prisma ORM, Axios (GitHub API), Node zlib (gunzip), AES-GCM for token encryption.
- **DB**: PostgreSQL (via Prisma). Schema: `Build`, `Repository`.
- **Worker**: Node.js poller for GitHub Actions workflow runs.
- **Alerting**: SMTP mail (host/user/pass via env) invoked from backend on failure.
- **Containerization**: Dockerfiles per service; docker-compose orchestrates.

## APIs/Tools Required

- **GitHub REST API**
  - List runs: `GET /repos/{owner}/{repo}/actions/runs`.
  - List jobs for run: `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`.
  - Job logs (gzip): `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`.
  - Auth: `Bearer {token}` if repo private or to raise rate limits.
- **SMTP** for email alerts.
- **Prisma Client** for DB access.
- **Docker/Docker Compose** for local deployment.

## Assumptions & Constraints

- `Build.externalId` stores GitHub run id; `Build.pipeline` format: `owner/repo/branch`.
- Per-repo token is stored encrypted (`Repository.tokenEnc`).
- Logs endpoints are text/plain for easy rendering/streaming.
- Compose v1 has a known recreate bug (workaround: remove and recreate `web`).

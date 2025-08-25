# 🏗️ Technical Design

## High-level Architecture

- **Frontend (`frontend/`)**: React app built with Vite, served via Nginx in `web` container.
- **Backend API (`backend/`)**: Node.js/Express with Prisma ORM exposing REST endpoints.
- **Database (`db`)**: PostgreSQL (Docker `db` service). Prisma manages schema.
- **Worker (`worker/`)**: Polls GitHub Actions runs and ingests into API.
- **Alerting**: Backend sends email via SMTP when a recent build fails.

Data flow:
- Worker -> GitHub API (list runs) -> Backend `/api/ingest` -> DB.
- Frontend -> Backend REST (metrics, builds, branches, logs).
- Backend -> GitHub API (jobs, logs) for on-demand logs.

## API Structure

Base URL: `${VITE_API_BASE}` (e.g., `http://localhost:8080`)

- `GET /api/metrics`
  - Query: `owner`, `repo`, `branch`
  - Response:
    ```json
    {"success_rate":0.87,"avg_build_time_sec":42.5,"last_status":"success","total_builds":120}
    ```
- `GET /api/builds`
  - Query: `limit` (default 20), `owner`, `repo`, `branch`
  - Response: Array of `Build` rows.
- `GET /api/branches`
  - Query: `owner`, `repo`
  - Response: `string[]` of branch names.
- `POST /api/ingest`
  - Body (example):
    ```json
    {"provider":"github","pipeline":"owner/repo/main","status":"success","duration_sec":34.2,"started_at":"...","finished_at":"...","commit":"abc1234","branch":"main","logs":"https://...","external_id":"123"}
    ```
  - Upserts by `external_id`.
- `GET /api/builds/:id/logs`
  - Text summary of jobs/steps for GitHub run.
- `GET /api/builds/:id/logs/full?tail=N`
  - Full concatenated job logs (gunzipped) with optional tail.
- `GET /api/repos`
  - List configured repositories (token hidden).
- `POST /api/repos`
  - Body: `{ owner, repo, branch?, token? }` (token stored encrypted)
- `POST /api/repos/:id/update`
  - Triggers GitHub sync for that repo (uses stored token if present).
- `DELETE /api/repos/:id`
- `GET /api/internal/repos`
  - Returns repos with decrypted tokens; requires `X-Internal-Token` header.
- `GET /healthz`

## Database Schema (Prisma)

From `backend/prisma/schema.prisma`:

```prisma
model Build {
  id           Int      @id @default(autoincrement())
  provider     String
  pipeline     String
  status       String   // success | failure | running
  durationSec  Float
  startedAt    DateTime @default(now())
  finishedAt   DateTime?
  commit       String?
  branch       String?
  logs         String?
  createdAt    DateTime @default(now())
  externalId   String?  @unique
  alertedAt    DateTime?
}

model Repository {
  id        Int      @id @default(autoincrement())
  owner     String
  repo      String
  branch    String?  // optional
  tokenEnc  String?  // encrypted token
  createdAt DateTime @default(now())
  @@unique([owner, repo, branch])
}
```

Notes:
- AES-GCM encryption used for tokens (see `backend/src/index.js` `encrypt()`/`decrypt()`).

## UI Layout

- **Header**: App title; optional info (auto-refresh cadence).
- **Metrics Cards**: Success rate (donut), average duration sparkline, last status, total builds.
- **Repo Management**: Add repo form (owner, repo, optional branch/token); list with Update/Delete actions.
- **Filter Bar** (when repo selected): Branch dropdown, rows limit, clear selection.
- **Builds Table**: Latest builds with expand arrow, status pill, duration, commit, branch.
- **Logs Drawer**: On expand, fetch summary; buttons for Tail 200/1000 full logs; link to provider run.

## Environment & Config

- Frontend: `VITE_API_BASE` used for API calls.
- Backend: `DATABASE_URL`, `PORT`, `INTERNAL_TOKEN`, `ENCRYPTION_KEY`, SMTP vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`).
- Worker: `API_BASE`, `INTERVAL_SECONDS`, `FAILURE_RATE` (sim), `MODE=github`, `GITHUB_OWNER`, `GITHUB_REPO`, `INTERNAL_TOKEN`.

## Deployment

- `docker-compose.yml` runs:
  - `db` (Postgres), `api` (Express), `worker` (poller), `web` (Nginx + built frontend).
- Known compose v1 quirk: on web image rebuild, remove and recreate `web` to avoid `'ContainerConfig'` error.

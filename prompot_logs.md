# Prompts and Requests Log

This document lists the key prompts/requests used to build and refine the CI/CD dashboard.

## Add execution logs feature (backend)
- Implement `GET /api/builds/:id/logs` to fetch GitHub Actions jobs/steps summary.
- Implement `GET /api/builds/:id/logs/full?tail=N` to download, gunzip, and concatenate all job logs with optional tail.
- Use per-repo encrypted GitHub tokens; handle pagination and errors.
- Return logs as `text/plain`.

## Add execution logs feature (frontend)
- Add expandable logs panel per build row with lazy loading on expand.
- Show loading/error states; render plain text logs in a scrollable area.
- Add “Tail 200” and “Tail 1000” buttons to fetch full logs.
- Add “Open run ↗” link to provider run URL.

## Fix API base usage in frontend
- Use `VITE_API_BASE` (fallback to origin-mapped 8080) for all fetches, especially logs, to avoid SPA HTML responses.
- Remove duplicate `API_BASE` declaration inside the component.

## Deploy/redeploy containers
- Rebuild and restart `web` after frontend changes.
- Rebuild and restart `api` when backend endpoints are added.
- Work around docker-compose v1 “ContainerConfig” recreate error by removing and recreating the `web` container.

## UI polish (later reverted per request)
- Add sticky header, centered layout, card shadows/rounded corners.
- Improve buttons (primary/secondary), row hover highlight, sticky table header.
- Improve logs panel typography and add “Copy” button.

## Revert UI
- Restore `frontend/src/App.jsx` to older UI and redeploy `web`.

## Git operations
- Commit and push: "feat(logs): expandable execution logs with summary + full tail endpoints; use API_BASE for requests".

## Runtime checks and verification
- Curl frontend `http://localhost:3000` for HTTP 200.
- Curl API health and endpoints: `/healthz`, `/api/metrics`, `/api/builds?limit=N`.
- Inspect `web` container logs for serving JS bundle and responses.

---
name: dev-server
description: Start Vite dev server + API server for UI development with hot reload
---

Start the development environment for working on UI files (`server/ui/src/`).

**Why:** Building `server/public/` after every UI change is slow and error-prone — the PWA service worker caches stale JS/CSS bundles. The Vite dev server provides instant hot module replacement with no build step.

## Steps

1. Check if the API server is already running:
   ```bash
   curl -s http://localhost:8080/healthz
   ```

2. If not running, start it in the background:
   ```bash
   cd server && API_PASSWORD=${API_PASSWORD:-test} node dist/index.js &
   ```
   Wait for the healthcheck to pass before proceeding.

3. Start the Vite dev server in the background:
   ```bash
   cd server/ui && npx vite --host &
   ```

4. Report the dev URLs to the user:
   - **UI (with HMR):** `http://localhost:5173`
   - **API server:** `http://localhost:8080`

## Important

- The user should open `http://localhost:5173` (NOT port 8080) for UI development
- Vite proxies `/api`, `/ws` (WebSocket), and `/healthz` to the API server automatically
- UI file changes hot-reload instantly — no rebuild, no cache clearing needed
- Server TypeScript changes (`server/src/`) still require `cd server && npm run build` and a server restart
- Only rebuild `server/public/` before committing (use `/build-and-test`)

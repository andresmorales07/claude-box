## UI Development Workflow

**When modifying `server/ui/src/` files, use the Vite dev server instead of rebuilding `server/public/`.** The production build pipeline (`vite build` → `server/public/`) plus the PWA service worker causes stale cached assets that require hard-refresh and cache clearing. The Vite dev server avoids this entirely with hot module replacement.

```bash
# Terminal 1: API server (backend)
cd server && API_PASSWORD=<password> npm start

# Terminal 2: Vite dev server (frontend with HMR)
cd server/ui && npm run dev
```

Open `http://localhost:5173` (NOT port 8080). UI changes hot-reload instantly — no build step, no cache clearing. The Vite proxy forwards `/api`, `/ws` (WebSocket), and `/healthz` to the API server on port 8080.

**When to rebuild:** Only rebuild `server/dist/` when `server/src/` (backend TypeScript) changes. `server/dist/` and `server/public/` are gitignored — no need to commit them; the Dockerfile rebuilds both from source at container build time.

## UI Conventions

- **Use the `frontend-design` skill** (invoke via `Skill` tool) whenever creating OR modifying UI components, pages, or layouts in `server/ui/src/` (web UI) or any mobile app directory. This applies to visual changes, new screens, component redesigns, responsive layout work, and styling updates — not backend-only API changes. **This includes small modifications** — "just updating a component" still requires invoking the skill. Do not rationalize skipping it.
- **WS `onclose` active-socket detection** — In `messages.ts`, use `const wasActive = ws === socket` (captured *before* `ws = null`) to determine if a closing socket was still the active one. This is the correct pattern for distinguishing "my socket dropped" from "I was replaced by a newer connect()". After a remap, if the socket drops, reconnect must use `currentSessionId` (the real ID), not the closure's stale `sessionId` (old temp UUID).

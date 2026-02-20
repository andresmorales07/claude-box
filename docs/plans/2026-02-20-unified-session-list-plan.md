# Unified Session List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the web UI sidebar show historical Claude Code CLI sessions alongside hatchpod-managed sessions, with provider badges, session naming, CWD-aware filtering, and full resume support.

**Architecture:** New `session-history.ts` module scans `~/.claude/projects/<mangled-cwd>/` JSONL files for session metadata (slug, first message, timestamps). `GET /api/sessions?cwd=...` merges live and historical sessions into a unified sorted list. The UI displays session names, provider badges, and supports clicking history sessions to resume them.

**Tech Stack:** Node.js fs/promises, TypeScript, React, Vite, vitest

**Design doc:** `docs/plans/2026-02-20-unified-session-list-design.md`

---

### Task 1: Update server types

**Files:**
- Modify: `server/src/types.ts`

**Step 1: Add `"history"` to `SessionStatus` (line 4-6)**

Replace the `SessionStatus` type union:

```typescript
export type SessionStatus =
  | "idle" | "starting" | "running" | "waiting_for_approval"
  | "completed" | "interrupted" | "error" | "history";
```

**Step 2: Add new fields to `SessionSummaryDTO` (line 44-52)**

Replace the full `SessionSummaryDTO`:

```typescript
/** Summary returned by GET /api/sessions (list endpoint). */
export interface SessionSummaryDTO {
  id: string;
  status: SessionStatus;
  createdAt: string;
  lastModified: string;
  numTurns: number;
  totalCostUsd: number;
  hasPendingApproval: boolean;
  provider: string;
  slug: string | null;
  summary: string | null;
}
```

**Step 3: Add `resumeSessionId` to `CreateSessionRequest` (line 77-84)**

```typescript
export interface CreateSessionRequest {
  prompt?: string;
  permissionMode?: PermissionModeCommon;
  provider?: string;
  model?: string;
  cwd?: string;
  allowedTools?: string[];
  resumeSessionId?: string;
}
```

**Step 4: Add `"history"` to the status pill in `styles.css`**

After the existing `.status.completed` rule (line 714-717 in styles.css), add:

```css
.status.history {
  background: rgba(136, 146, 164, 0.1);
  color: var(--text-muted);
  font-style: italic;
}
```

**Step 5: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: May have errors in `sessions.ts` due to missing `lastModified`/`provider`/`slug`/`summary` fields — that's fine, we'll fix those in Tasks 2-3.

**Step 6: Commit**

```bash
git add server/src/types.ts server/ui/src/styles.css
git commit -m "feat: add history status, provider/slug/summary fields to SessionSummaryDTO"
```

---

### Task 2: Create session-history module

**Files:**
- Create: `server/src/session-history.ts`
- Test: `server/tests/session-history.test.ts`

**Step 1: Write the test file**

Create `server/tests/session-history.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { writeFile, mkdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// We test the module's functions directly
let listSessionHistory: typeof import("../src/session-history.js").listSessionHistory;
let cwdToProjectDir: typeof import("../src/session-history.js").cwdToProjectDir;
let clearHistoryCache: typeof import("../src/session-history.js").clearHistoryCache;

const testDir = join(tmpdir(), `hatchpod-history-test-${Date.now()}`);
const fakeClaudeDir = join(testDir, ".claude", "projects");
const fakeCwd = "/home/user/workspace/myproject";
const fakeProjectDir = join(fakeClaudeDir, "-home-user-workspace-myproject");

beforeAll(async () => {
  // Override HOME so cwdToProjectDir resolves to our test directory
  process.env.CLAUDE_PROJECTS_DIR = fakeClaudeDir;

  // Import after setting env
  const mod = await import("../src/session-history.js");
  listSessionHistory = mod.listSessionHistory;
  cwdToProjectDir = mod.cwdToProjectDir;
  clearHistoryCache = mod.clearHistoryCache;

  await mkdir(fakeProjectDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.CLAUDE_PROJECTS_DIR;
  await rm(testDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearHistoryCache();
});

function makeJsonl(sessionId: string, opts: {
  slug?: string;
  userMessage?: string;
  timestamp?: string;
  cwd?: string;
}): string {
  const ts = opts.timestamp ?? "2026-02-20T10:00:00.000Z";
  const lines: string[] = [];
  // Progress line with slug
  lines.push(JSON.stringify({
    type: "progress",
    sessionId,
    slug: opts.slug ?? null,
    cwd: opts.cwd ?? fakeCwd,
    timestamp: ts,
  }));
  // User message
  if (opts.userMessage) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId,
      slug: opts.slug ?? null,
      cwd: opts.cwd ?? fakeCwd,
      timestamp: ts,
      message: { role: "user", content: opts.userMessage },
    }));
  }
  return lines.join("\n") + "\n";
}

describe("session-history", () => {
  describe("cwdToProjectDir", () => {
    it("mangles CWD path correctly", () => {
      const dir = cwdToProjectDir("/home/user/workspace/myproject");
      expect(dir).toContain("-home-user-workspace-myproject");
    });
  });

  describe("listSessionHistory", () => {
    it("returns empty array when project dir does not exist", async () => {
      const result = await listSessionHistory("/nonexistent/path");
      expect(result).toEqual([]);
    });

    it("discovers sessions from JSONL files", async () => {
      const sid = randomUUID();
      const content = makeJsonl(sid, {
        slug: "happy-dancing-cat",
        userMessage: "Hello world",
        timestamp: "2026-02-20T12:00:00.000Z",
      });
      await writeFile(join(fakeProjectDir, `${sid}.jsonl`), content);

      const result = await listSessionHistory(fakeCwd);
      const found = result.find((s) => s.id === sid);
      expect(found).toBeDefined();
      expect(found!.slug).toBe("happy-dancing-cat");
      expect(found!.summary).toBe("Hello world");
    });

    it("uses file mtime as lastModified", async () => {
      const sid = randomUUID();
      const content = makeJsonl(sid, { slug: "test-slug" });
      const filePath = join(fakeProjectDir, `${sid}.jsonl`);
      await writeFile(filePath, content);

      // Set a known mtime
      const knownDate = new Date("2026-01-15T08:00:00.000Z");
      await utimes(filePath, knownDate, knownDate);

      const result = await listSessionHistory(fakeCwd);
      const found = result.find((s) => s.id === sid);
      expect(found).toBeDefined();
      expect(found!.lastModified.getTime()).toBe(knownDate.getTime());
    });

    it("truncates long user messages to 80 chars", async () => {
      const sid = randomUUID();
      const longMsg = "A".repeat(200);
      const content = makeJsonl(sid, { userMessage: longMsg });
      await writeFile(join(fakeProjectDir, `${sid}.jsonl`), content);

      const result = await listSessionHistory(fakeCwd);
      const found = result.find((s) => s.id === sid);
      expect(found!.summary!.length).toBeLessThanOrEqual(80);
    });

    it("caches results and reuses on same mtime", async () => {
      const sid = randomUUID();
      const content = makeJsonl(sid, { slug: "cached-slug" });
      const filePath = join(fakeProjectDir, `${sid}.jsonl`);
      await writeFile(filePath, content);

      const result1 = await listSessionHistory(fakeCwd);
      const result2 = await listSessionHistory(fakeCwd);
      // Both should return the same data
      expect(result1.find((s) => s.id === sid)!.slug).toBe("cached-slug");
      expect(result2.find((s) => s.id === sid)!.slug).toBe("cached-slug");
    });

    it("skips non-JSONL files and directories", async () => {
      await writeFile(join(fakeProjectDir, "not-a-session.txt"), "hello");
      await mkdir(join(fakeProjectDir, "some-subdir"), { recursive: true });

      // Should not throw
      const result = await listSessionHistory(fakeCwd);
      // No entry for the txt file or subdir
      expect(result.every((s) => s.id !== "not-a-session")).toBe(true);
    });
  });
});
```

**Step 2: Write the session-history module**

Create `server/src/session-history.ts`:

```typescript
import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface HistorySession {
  id: string;
  slug: string | null;
  summary: string | null;
  cwd: string;
  lastModified: Date;
  createdAt: Date;
}

interface CacheEntry {
  mtimeMs: number;
  session: HistorySession;
}

const cache = new Map<string, CacheEntry>();

/** Convert a CWD path to the Claude Code project directory path. */
export function cwdToProjectDir(cwd: string): string {
  const base = process.env.CLAUDE_PROJECTS_DIR
    ?? join(homedir(), ".claude", "projects");
  const mangled = cwd.replace(/\//g, "-");
  return join(base, mangled);
}

/** Clear the cache (for tests). */
export function clearHistoryCache(): void {
  cache.clear();
}

const MAX_LINES_TO_READ = 50;
const MAX_SUMMARY_LENGTH = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Parse metadata from the first N lines of a JSONL session file. */
async function parseSessionMetadata(
  filePath: string,
  sessionId: string,
  mtimeMs: number,
): Promise<HistorySession> {
  let slug: string | null = null;
  let summary: string | null = null;
  let cwd = "";
  let firstTimestamp: string | null = null;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;
  for await (const line of rl) {
    if (lineCount++ >= MAX_LINES_TO_READ) break;
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Extract slug (first non-null occurrence)
    if (!slug && typeof parsed.slug === "string" && parsed.slug) {
      slug = parsed.slug;
    }

    // Extract cwd
    if (!cwd && typeof parsed.cwd === "string" && parsed.cwd) {
      cwd = parsed.cwd;
    }

    // Extract first timestamp
    if (!firstTimestamp && typeof parsed.timestamp === "string") {
      firstTimestamp = parsed.timestamp;
    }

    // Extract first user message as summary
    if (
      !summary &&
      parsed.type === "user" &&
      parsed.message &&
      typeof parsed.message === "object"
    ) {
      const msg = parsed.message as Record<string, unknown>;
      if (typeof msg.content === "string" && msg.content && !msg.content.startsWith("<")) {
        summary = msg.content.length > MAX_SUMMARY_LENGTH
          ? msg.content.slice(0, MAX_SUMMARY_LENGTH)
          : msg.content;
        // Collapse newlines for display
        summary = summary.replace(/\n+/g, " ").trim();
      }
    }

    // Early exit if we have everything
    if (slug && summary && cwd && firstTimestamp) break;
  }

  return {
    id: sessionId,
    slug,
    summary,
    cwd,
    lastModified: new Date(mtimeMs),
    createdAt: firstTimestamp ? new Date(firstTimestamp) : new Date(mtimeMs),
  };
}

/** List historical Claude Code sessions for a given CWD. */
export async function listSessionHistory(cwd: string): Promise<HistorySession[]> {
  const projectDir = cwdToProjectDir(cwd);

  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter(
    (name) => name.endsWith(".jsonl") && UUID_RE.test(name.replace(".jsonl", "")),
  );

  const results: HistorySession[] = [];

  for (const fileName of jsonlFiles) {
    const filePath = join(projectDir, fileName);
    const sessionId = fileName.replace(".jsonl", "");

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }

    // Check cache
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      results.push(cached.session);
      continue;
    }

    // Parse and cache
    try {
      const session = await parseSessionMetadata(filePath, sessionId, fileStat.mtimeMs);
      cache.set(filePath, { mtimeMs: fileStat.mtimeMs, session });
      results.push(session);
    } catch (err) {
      console.warn(`Failed to parse session history file ${filePath}:`, err);
    }
  }

  return results;
}
```

**Step 3: Run the test**

Run: `cd server && npx vitest run tests/session-history.test.ts`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add server/src/session-history.ts server/tests/session-history.test.ts
git commit -m "feat: add session-history module for JSONL scanning"
```

---

### Task 3: Update sessions.ts for merged listing and resume

**Files:**
- Modify: `server/src/sessions.ts:25-34` (listSessions function)
- Modify: `server/src/sessions.ts:91-122` (createSession function)
- Modify: `server/src/sessions.ts:272-288` (sendFollowUp function)

**Step 1: Update `listSessions` to merge history and accept CWD param**

Replace the `listSessions` function (line 25-34):

```typescript
export function listSessions(cwd?: string): SessionSummaryDTO[] {
  const liveSessions: SessionSummaryDTO[] = Array.from(sessions.values()).map((s) => {
    const lastMsg = s.messages[s.messages.length - 1];
    const lastModified = lastMsg
      ? new Date().toISOString()  // approximate: use current time for active sessions
      : s.createdAt.toISOString();
    return {
      id: s.id,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      lastModified,
      numTurns: s.numTurns,
      totalCostUsd: s.totalCostUsd,
      hasPendingApproval: s.pendingApproval !== null,
      provider: s.provider,
      slug: s.providerSessionId ? null : null, // live sessions don't have slugs yet
      summary: null,
    };
  });
  return liveSessions;
}
```

Note: The full merge with history will happen in `listSessionsWithHistory` — an async version called from routes. The sync `listSessions` stays for backwards compat with tests.

Add a new async function after `listSessions`:

```typescript
export async function listSessionsWithHistory(cwd?: string): Promise<SessionSummaryDTO[]> {
  const liveSessions = listSessions(cwd);

  if (!cwd) return liveSessions;

  const { listSessionHistory } = await import("./session-history.js");
  let history: Awaited<ReturnType<typeof listSessionHistory>>;
  try {
    history = await listSessionHistory(cwd);
  } catch {
    return liveSessions;
  }

  // Build set of provider session IDs that are already live
  const liveProviderIds = new Set<string>();
  for (const s of sessions.values()) {
    if (s.providerSessionId) liveProviderIds.add(s.providerSessionId);
  }

  // Enrich live sessions with slug/summary from history
  for (const live of liveSessions) {
    const session = sessions.get(live.id);
    if (!session?.providerSessionId) continue;
    const histMatch = history.find((h) => h.id === session.providerSessionId);
    if (histMatch) {
      live.slug = histMatch.slug;
      live.summary = histMatch.summary;
      live.lastModified = histMatch.lastModified.toISOString();
    }
  }

  // Add history-only sessions (not already live)
  for (const h of history) {
    if (liveProviderIds.has(h.id)) continue;
    liveSessions.push({
      id: h.id,
      status: "history",
      createdAt: h.createdAt.toISOString(),
      lastModified: h.lastModified.toISOString(),
      numTurns: 0,
      totalCostUsd: 0,
      hasPendingApproval: false,
      provider: "claude",
      slug: h.slug,
      summary: h.summary,
    });
  }

  // Sort by lastModified descending
  liveSessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  return liveSessions;
}
```

**Step 2: Update `createSession` to handle `resumeSessionId`**

In `createSession` (line 91-122), after `const id = randomUUID();`, add handling for `resumeSessionId`:

```typescript
export async function createSession(
  req: CreateSessionRequest,
): Promise<Session> {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`maximum session limit reached (${MAX_SESSIONS})`);
  }
  const hasPrompt = typeof req.prompt === "string" && req.prompt.length > 0;
  const id = randomUUID();
  const session: Session = {
    id,
    provider: req.provider ?? "claude",
    providerSessionId: req.resumeSessionId, // pre-set for resume
    status: hasPrompt ? "starting" : "idle",
    createdAt: new Date(),
    permissionMode: req.permissionMode ?? "default",
    model: req.model,
    cwd: req.cwd ?? (process.env.DEFAULT_CWD ?? process.cwd()),
    abortController: new AbortController(),
    messages: [],
    slashCommands: [],
    totalCostUsd: 0,
    numTurns: 0,
    lastError: null,
    pendingApproval: null,
    alwaysAllowedTools: new Set<string>(),
    clients: new Set<WebSocket>(),
  };
  sessions.set(id, session);
  if (hasPrompt) {
    runSession(session, req.prompt!, req.allowedTools, req.resumeSessionId);
  }
  return session;
}
```

Key change: `providerSessionId: req.resumeSessionId` — this ensures `sendFollowUp` uses the right resume ID. And when a prompt is provided, pass `resumeSessionId` to `runSession`.

**Step 3: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: Pass (or errors only in routes.ts which we fix next).

**Step 4: Commit**

```bash
git add server/src/sessions.ts
git commit -m "feat: merge session history into listing, support resumeSessionId"
```

---

### Task 4: Update routes for CWD query param and providers endpoint

**Files:**
- Modify: `server/src/routes.ts:1-13` (imports)
- Modify: `server/src/routes.ts:141-145` (GET /api/sessions)
- Add: new `GET /api/providers` route

**Step 1: Update imports (line 6)**

Add `listSessionsWithHistory` to the import from sessions:

```typescript
import {
  listSessions,
  listSessionsWithHistory,
  getSession,
  sessionToDTO,
  getSessionCount,
  createSession,
  interruptSession,
} from "./sessions.js";
import { listProviders } from "./providers/index.js";
```

**Step 2: Update GET /api/sessions handler (line 141-145)**

Replace:

```typescript
  // GET /api/sessions — list sessions
  if (pathname === "/api/sessions" && method === "GET") {
    json(res, 200, listSessions());
    return;
  }
```

With:

```typescript
  // GET /api/sessions — list sessions (optionally filtered by CWD for history)
  if (pathname === "/api/sessions" && method === "GET") {
    const cwd = url.searchParams.get("cwd") ?? undefined;
    try {
      const sessions = await listSessionsWithHistory(cwd);
      json(res, 200, sessions);
    } catch (err) {
      console.error("Failed to list sessions:", err);
      json(res, 500, { error: "internal server error" });
    }
    return;
  }
```

**Step 3: Add GET /api/providers endpoint**

After the `GET /api/config` handler (after line 175), add:

```typescript
  // GET /api/providers — list registered providers
  if (pathname === "/api/providers" && method === "GET") {
    json(res, 200, listProviders());
    return;
  }
```

**Step 4: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: Pass.

**Step 5: Commit**

```bash
git add server/src/routes.ts
git commit -m "feat: add CWD param to session listing, add providers endpoint"
```

---

### Task 5: Update SessionList UI component

**Files:**
- Modify: `server/ui/src/components/SessionList.tsx`

**Step 1: Rewrite SessionList with provider badges, names, and resume support**

Replace the entire file:

```tsx
import { useState, useEffect, useCallback } from "react";

interface SessionSummary {
  id: string;
  status: string;
  createdAt: string;
  lastModified: string;
  numTurns: number;
  totalCostUsd: number;
  hasPendingApproval: boolean;
  provider: string;
  slug: string | null;
  summary: string | null;
}

interface Props {
  token: string;
  cwd: string;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onResumeSession: (historySessionId: string) => void;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sessionDisplayName(s: SessionSummary): string {
  if (s.slug) return s.slug;
  if (s.summary) return s.summary;
  return s.id.slice(0, 8);
}

export function SessionList({ token, cwd, activeSessionId, onSelectSession, onResumeSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const res = await fetch(`/api/sessions${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSessions(await res.json());
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  }, [token, cwd]);

  useEffect(() => { fetchSessions(); const interval = setInterval(fetchSessions, 5000); return () => clearInterval(interval); }, [fetchSessions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.trim(), cwd }) });
      if (res.ok) { const session = await res.json(); setPrompt(""); onSelectSession(session.id); fetchSessions(); }
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally { setCreating(false); }
  };

  const handleClick = (s: SessionSummary) => {
    if (s.status === "history") {
      onResumeSession(s.id);
    } else {
      onSelectSession(s.id);
    }
  };

  return (
    <div className="session-list-container">
      <div className="session-list">
        {sessions.length === 0 && <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No sessions yet</p>}
        {sessions.map((s) => (
          <div key={s.id} className={`session-item ${s.id === activeSessionId ? "active" : ""}`} onClick={() => handleClick(s)}>
            <div className="session-item-info">
              <div className="session-name">{sessionDisplayName(s)}</div>
              <div className="session-meta">
                <span className="session-time">{relativeTime(s.lastModified || s.createdAt)}</span>
              </div>
            </div>
            <div className="session-badges">
              <span className="provider-badge">{s.provider}</span>
              <span className={`status ${s.status}`}>{s.status}</span>
            </div>
          </div>
        ))}
      </div>
      <form className="new-session-form" onSubmit={handleCreate}>
        <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="New session prompt..." disabled={creating} />
        <button type="submit" disabled={creating || !prompt.trim()}>{creating ? "..." : "New"}</button>
      </form>
    </div>
  );
}
```

**Step 2: Run Vite type check**

Run: `cd server/ui && npx tsc --noEmit`
Expected: May fail on App.tsx missing `onResumeSession` prop — fixed in Task 6.

**Step 3: Commit**

```bash
git add server/ui/src/components/SessionList.tsx
git commit -m "feat: update SessionList with provider badges, names, and resume"
```

---

### Task 6: Update App.tsx for resume handler

**Files:**
- Modify: `server/ui/src/App.tsx`

**Step 1: Add resume handler and pass to SessionList**

Replace the `startSession` callback and the `<SessionList>` JSX in `App.tsx`:

The `startSession` callback (line 29-44) stays as-is. Add a new `resumeSession` callback after it:

```typescript
  const resumeSession = useCallback(async (historySessionId: string) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ resumeSessionId: historySessionId, cwd, provider: "claude" }),
      });
      if (res.ok) {
        const session = await res.json();
        setActiveSessionId(session.id);
        setShowSidebar(false);
      }
    } catch (err) {
      console.error("Failed to resume session:", err);
    }
  }, [token, cwd]);
```

Update the `<SessionList>` JSX (line 61) to pass the new prop:

```tsx
<SessionList
  token={token}
  cwd={cwd}
  activeSessionId={activeSessionId}
  onSelectSession={(id) => { setActiveSessionId(id); setShowSidebar(false); }}
  onResumeSession={resumeSession}
/>
```

**Step 2: Run full type check**

Run: `cd server && npx tsc --noEmit`
Expected: Pass.

Run: `cd server/ui && npx tsc --noEmit`
Expected: Pass.

**Step 3: Commit**

```bash
git add server/ui/src/App.tsx
git commit -m "feat: add resume handler to App, wire to SessionList"
```

---

### Task 7: Add CSS styles for session list improvements

**Files:**
- Modify: `server/ui/src/styles.css`

**Step 1: Replace session item styles and add new classes**

After the existing `.session-item.active` rule (line 184-187), add/replace these styles:

```css
.session-item-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.session-name {
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.125rem;
}

.session-time {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.session-badges {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
  margin-left: 0.5rem;
}

.provider-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.0625rem 0.3125rem;
  border-radius: 999px;
  background: rgba(136, 146, 164, 0.15);
  color: var(--text-muted);
  white-space: nowrap;
}
```

**Step 2: Commit**

```bash
git add server/ui/src/styles.css
git commit -m "feat: add session list styles for names, badges, and time"
```

---

### Task 8: Build, test, and verify

**Files:**
- All modified files

**Step 1: Run full type check**

Run: `cd server && npx tsc --noEmit`
Expected: Pass with no errors.

**Step 2: Build server**

Run: `cd server && npm run build`
Expected: Compiles successfully.

**Step 3: Build UI**

Run: `cd server/ui && npm run build`
Expected: Vite build succeeds.

**Step 4: Run all tests**

Run: `cd server && npm test`
Expected: All tests pass, including the new `session-history.test.ts`.

**Step 5: Stage and commit dist**

```bash
git add server/dist/
git commit -m "chore: rebuild dist after unified session list changes"
```

---

### Task 9: Integration test for providers endpoint and session listing

**Files:**
- Modify: `server/tests/session-crud.test.ts`

**Step 1: Add providers endpoint test**

Add to the existing session-crud test file:

```typescript
it("GET /api/providers returns registered providers", async () => {
  const res = await api("/api/providers");
  expect(res.status).toBe(200);
  const providers = await res.json();
  expect(Array.isArray(providers)).toBe(true);
  expect(providers.length).toBeGreaterThanOrEqual(1);
  // In test env, both claude and test should be registered
  const ids = providers.map((p: { id: string }) => p.id);
  expect(ids).toContain("test");
});
```

**Step 2: Add session listing with new fields test**

```typescript
it("GET /api/sessions returns sessions with provider and new fields", async () => {
  // Create a session first
  const createRes = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ prompt: "test listing", provider: "test" }),
  });
  expect(createRes.status).toBe(201);

  // List sessions
  const listRes = await api("/api/sessions");
  expect(listRes.status).toBe(200);
  const sessions = await listRes.json();
  expect(sessions.length).toBeGreaterThanOrEqual(1);

  const session = sessions.find((s: { provider: string }) => s.provider === "test");
  expect(session).toBeDefined();
  expect(session).toHaveProperty("provider");
  expect(session).toHaveProperty("slug");
  expect(session).toHaveProperty("summary");
  expect(session).toHaveProperty("lastModified");
});
```

**Step 3: Run tests**

Run: `cd server && npm test`
Expected: All pass.

**Step 4: Commit**

```bash
git add server/tests/session-crud.test.ts
git commit -m "test: add providers endpoint and enriched session listing tests"
```

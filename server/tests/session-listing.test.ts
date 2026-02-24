import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { writeFile, mkdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const testDir = join(tmpdir(), `hatchpod-listing-test-${Date.now()}`);
const fakeClaudeDir = join(testDir, ".claude", "projects");
// Two project directories to test cross-directory deduplication
const fakeProjectDir1 = join(fakeClaudeDir, "-home-user-workspace-project-a");
const fakeProjectDir2 = join(fakeClaudeDir, "-home-user-workspace-project-b");

let startServer: typeof import("./helpers.js").startServer;
let stopServer: typeof import("./helpers.js").stopServer;
let api: typeof import("./helpers.js").api;
let resetSessions: typeof import("./helpers.js").resetSessions;
let clearHistoryCache: typeof import("../src/session-history.js").clearHistoryCache;

function makeJsonl(sessionId: string, opts: {
  slug?: string;
  userMessage?: string;
  cwd?: string;
  timestamp?: string;
}): string {
  const ts = opts.timestamp ?? "2026-02-20T10:00:00.000Z";
  return [
    JSON.stringify({
      type: "progress",
      sessionId,
      slug: opts.slug ?? null,
      cwd: opts.cwd ?? "/home/user/workspace/project-a",
      timestamp: ts,
    }),
    ...(opts.userMessage ? [JSON.stringify({
      type: "user",
      sessionId,
      cwd: opts.cwd ?? "/home/user/workspace/project-a",
      timestamp: ts,
      message: { role: "user", content: opts.userMessage },
    })] : []),
  ].join("\n") + "\n";
}

beforeAll(async () => {
  process.env.CLAUDE_PROJECTS_DIR = fakeClaudeDir;
  await mkdir(fakeProjectDir1, { recursive: true });
  await mkdir(fakeProjectDir2, { recursive: true });

  const helpers = await import("./helpers.js");
  startServer = helpers.startServer;
  stopServer = helpers.stopServer;
  api = helpers.api;
  resetSessions = helpers.resetSessions;

  const historyMod = await import("../src/session-history.js");
  clearHistoryCache = historyMod.clearHistoryCache;

  await startServer();
});

afterAll(async () => {
  await stopServer();
  delete process.env.CLAUDE_PROJECTS_DIR;
  await rm(testDir, { recursive: true, force: true });
});

beforeEach(async () => {
  clearHistoryCache();
  await resetSessions();
});

describe("GET /api/sessions — history merge + dedup", () => {
  it("history-only sessions appear with status 'history'", async () => {
    const sid = randomUUID();
    await writeFile(
      join(fakeProjectDir1, `${sid}.jsonl`),
      makeJsonl(sid, { slug: "test-slug", userMessage: "Hello" }),
    );

    const res = await api("/api/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; status: string; slug: string | null; summary: string | null }>;
    const found = body.find((s) => s.id === sid);
    expect(found).toBeDefined();
    expect(found!.status).toBe("history");
    expect(found!.slug).toBe("test-slug");
    expect(found!.summary).toBe("Hello");
  });

  it("multiple history sessions sorted by lastModified descending", async () => {
    const sid1 = randomUUID();
    const sid2 = randomUUID();
    const sid3 = randomUUID();

    // Write with different mtimes
    const path1 = join(fakeProjectDir1, `${sid1}.jsonl`);
    const path2 = join(fakeProjectDir1, `${sid2}.jsonl`);
    const path3 = join(fakeProjectDir1, `${sid3}.jsonl`);

    await writeFile(path1, makeJsonl(sid1, { slug: "oldest" }));
    await writeFile(path2, makeJsonl(sid2, { slug: "middle" }));
    await writeFile(path3, makeJsonl(sid3, { slug: "newest" }));

    // Set mtimes to control sort order
    await utimes(path1, new Date("2026-01-01"), new Date("2026-01-01"));
    await utimes(path2, new Date("2026-02-01"), new Date("2026-02-01"));
    await utimes(path3, new Date("2026-03-01"), new Date("2026-03-01"));

    const res = await api("/api/sessions");
    const body = await res.json() as Array<{ id: string; slug: string | null }>;

    // Filter to our test sessions
    const ourSessions = body.filter((s) => [sid1, sid2, sid3].includes(s.id));
    expect(ourSessions).toHaveLength(3);
    // Should be sorted newest first
    expect(ourSessions[0].slug).toBe("newest");
    expect(ourSessions[1].slug).toBe("middle");
    expect(ourSessions[2].slug).toBe("oldest");
  });

  it("deduplicates history sessions across project directories", async () => {
    const sid = randomUUID();

    // Same session UUID in two different project directories
    await writeFile(
      join(fakeProjectDir1, `${sid}.jsonl`),
      makeJsonl(sid, { slug: "from-project-a", cwd: "/home/user/workspace/project-a" }),
    );
    await writeFile(
      join(fakeProjectDir2, `${sid}.jsonl`),
      makeJsonl(sid, { slug: "from-project-b", cwd: "/home/user/workspace/project-b" }),
    );

    const res = await api("/api/sessions");
    const body = await res.json() as Array<{ id: string }>;

    // Should only appear once, not twice
    const matches = body.filter((s) => s.id === sid);
    expect(matches).toHaveLength(1);
  });

  it("filters by ?cwd= returning only matching sessions", async () => {
    const sid = randomUUID();
    // Use process.cwd() as the cwd value since BROWSE_ROOT defaults to cwd
    const cwdValue = process.cwd();
    const mangledCwd = cwdValue.replace(/\//g, "-");
    const cwdProjectDir = join(fakeClaudeDir, mangledCwd);
    await mkdir(cwdProjectDir, { recursive: true });
    await writeFile(
      join(cwdProjectDir, `${sid}.jsonl`),
      makeJsonl(sid, { slug: "cwd-test", cwd: cwdValue }),
    );

    // Query with cwd matching BROWSE_ROOT (which is process.cwd())
    const res = await api(`/api/sessions?cwd=${encodeURIComponent(cwdValue)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const found = body.find((s) => s.id === sid);
    expect(found).toBeDefined();
  });

  it("rejects ?cwd= with path traversal", async () => {
    const res = await api("/api/sessions?cwd=../../etc");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/cwd/);
  });

  it("rejects ?cwd= with null byte", async () => {
    const res = await api("/api/sessions?cwd=foo%00bar");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid cwd/);
  });
});

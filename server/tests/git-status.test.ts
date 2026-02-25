import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { GitDiffStatSchema } from "../src/schemas/git.js";
import { computeGitDiffStat } from "../src/git-status.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("GitDiffStatSchema", () => {
  it("validates a valid diff stat", () => {
    const stat = {
      files: [
        { path: "src/foo.ts", insertions: 5, deletions: 2, binary: false, untracked: false, staged: false },
        { path: "image.png", insertions: 0, deletions: 0, binary: true, untracked: false, staged: true },
      ],
      totalInsertions: 5,
      totalDeletions: 2,
    };
    expect(GitDiffStatSchema.parse(stat)).toEqual(stat);
  });

  it("rejects negative insertion count", () => {
    const stat = {
      files: [{ path: "a.ts", insertions: -1, deletions: 0, binary: false, untracked: false, staged: false }],
      totalInsertions: -1,
      totalDeletions: 0,
    };
    expect(() => GitDiffStatSchema.parse(stat)).toThrow();
  });
});

const execFile = promisify(execFileCb);

describe("computeGitDiffStat", () => {
  let repoDir: string;

  // Helper: create a temp git repo with one initial commit
  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "git-diff-test-"));
    await execFile("git", ["init", dir]);
    await execFile("git", ["-C", dir, "config", "user.email", "test@test.com"]);
    await execFile("git", ["-C", dir, "config", "user.name", "Test"]);
    await writeFile(join(dir, "initial.txt"), "hello\n");
    await execFile("git", ["-C", dir, "add", "."]);
    await execFile("git", ["-C", dir, "commit", "-m", "initial"]);
    return dir;
  }

  beforeEach(async () => {
    repoDir = await createTempRepo();
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns null for a non-git directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "no-git-"));
    const result = await computeGitDiffStat(dir);
    expect(result).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty stat for clean repo", async () => {
    const result = await computeGitDiffStat(repoDir);
    expect(result).toEqual({ files: [], totalInsertions: 0, totalDeletions: 0 });
  });

  it("detects unstaged modifications", async () => {
    await writeFile(join(repoDir, "initial.txt"), "hello\nworld\n");
    const result = await computeGitDiffStat(repoDir);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0]).toMatchObject({
      path: "initial.txt",
      insertions: 1,
      deletions: 0,
      binary: false,
      untracked: false,
      staged: false,
    });
    expect(result!.totalInsertions).toBe(1);
  });

  it("detects staged changes", async () => {
    await writeFile(join(repoDir, "initial.txt"), "modified\n");
    await execFile("git", ["-C", repoDir, "add", "initial.txt"]);
    const result = await computeGitDiffStat(repoDir);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].staged).toBe(true);
  });

  it("detects untracked files", async () => {
    await writeFile(join(repoDir, "new-file.ts"), "content\n");
    const result = await computeGitDiffStat(repoDir);
    expect(result).not.toBeNull();
    const untracked = result!.files.find((f) => f.path === "new-file.ts");
    expect(untracked).toBeDefined();
    expect(untracked!.untracked).toBe(true);
    expect(untracked!.insertions).toBe(0);
    expect(untracked!.deletions).toBe(0);
  });

  it("combines staged, unstaged, and untracked in a single result", async () => {
    await writeFile(join(repoDir, "initial.txt"), "changed\n");
    await execFile("git", ["-C", repoDir, "add", "initial.txt"]);
    await writeFile(join(repoDir, "initial.txt"), "changed again\n");
    await writeFile(join(repoDir, "brand-new.ts"), "new\n");
    const result = await computeGitDiffStat(repoDir);
    expect(result).not.toBeNull();
    expect(result!.files.length).toBeGreaterThanOrEqual(2);
  });
});

// ── REST endpoint tests ──

import { startServer, stopServer, api, rawFetch } from "./helpers.js";

describe("GET /api/git/status", () => {
  beforeAll(async () => { await startServer(); });
  afterAll(async () => { await stopServer(); });

  it("returns git diff stat for a valid git repo", async () => {
    const cwd = process.cwd();
    const res = await api(`/api/git/status?cwd=${encodeURIComponent(cwd)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("files");
    expect(body).toHaveProperty("totalInsertions");
    expect(body).toHaveProperty("totalDeletions");
    expect(Array.isArray(body.files)).toBe(true);
  });

  it("returns 400 when cwd is missing", async () => {
    const res = await api("/api/git/status");
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await rawFetch("/api/git/status?cwd=.");
    expect(res.status).toBe(401);
  });
});

// ── SessionWatcher git_diff_stat buffering tests ──

import { SessionWatcher } from "../src/session-watcher.js";

describe("SessionWatcher git_diff_stat buffering", () => {
  it("buffers and replays git_diff_stat to late subscribers", async () => {
    const mockAdapter = {
      getSessionFilePath: async () => null,
      normalizeFileLine: () => null,
      getMessages: async () => ({ messages: [], tasks: [], totalMessages: 0, hasMore: false, oldestIndex: 0 }),
      listSessions: async () => [],
      getSessionHistory: async () => [],
      run: () => { throw new Error("not implemented"); },
    } as any;

    const watcher = new SessionWatcher(mockAdapter);
    const sessionId = "test-git-session";
    watcher.setMode(sessionId, "push");

    // Push a git_diff_stat event with no subscribers
    watcher.pushEvent(sessionId, {
      type: "git_diff_stat",
      files: [{ path: "foo.ts", insertions: 3, deletions: 1, binary: false, untracked: false, staged: false }],
      totalInsertions: 3,
      totalDeletions: 1,
    } as any);

    // Late subscriber receives buffered stat
    const messages: any[] = [];
    const mockWs = {
      readyState: 1,
      send: (data: string) => { messages.push(JSON.parse(data)); },
    } as any;

    await watcher.subscribe(sessionId, mockWs);

    const gitMsg = messages.find((m: any) => m.type === "git_diff_stat");
    expect(gitMsg).toBeDefined();
    expect(gitMsg.totalInsertions).toBe(3);
    expect(gitMsg.files).toHaveLength(1);
  });

  it("clears git_diff_stat on terminal status", async () => {
    const mockAdapter = {
      getSessionFilePath: async () => null,
      normalizeFileLine: () => null,
      getMessages: async () => ({ messages: [], tasks: [], totalMessages: 0, hasMore: false, oldestIndex: 0 }),
      listSessions: async () => [],
      getSessionHistory: async () => [],
      run: () => { throw new Error("not implemented"); },
    } as any;

    const watcher = new SessionWatcher(mockAdapter);
    const sessionId = "test-git-clear";
    watcher.setMode(sessionId, "push");

    watcher.pushEvent(sessionId, {
      type: "git_diff_stat",
      files: [{ path: "foo.ts", insertions: 1, deletions: 0, binary: false, untracked: false, staged: false }],
      totalInsertions: 1,
      totalDeletions: 0,
    } as any);

    // Terminal status clears the buffer
    watcher.pushEvent(sessionId, { type: "status", status: "completed" });

    const messages: any[] = [];
    const mockWs = {
      readyState: 1,
      send: (data: string) => { messages.push(JSON.parse(data)); },
    } as any;

    await watcher.subscribe(sessionId, mockWs);

    const gitMsg = messages.find((m: any) => m.type === "git_diff_stat");
    expect(gitMsg).toBeUndefined();
  });
});

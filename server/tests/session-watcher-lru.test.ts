import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NormalizedMessage, ProviderAdapter, PaginatedMessages } from "../src/providers/types.js";
import { SessionWatcher } from "../src/session-watcher.js";
import { EventBus } from "../src/event-bus.js";
import { WsBroadcaster } from "../src/ws-broadcaster.js";

// ── Helpers ──

const testDir = join(tmpdir(), `hatchpod-lru-test-${Date.now()}`);
let subDir: string;
let subDirCounter = 0;

function createWatcherWithDeps(adapter: ProviderAdapter) {
  const bus = new EventBus();
  const broadcaster = new WsBroadcaster(bus);
  const watcher = new SessionWatcher(adapter, bus, broadcaster);
  return { watcher, bus, broadcaster };
}

function createMockAdapter(filePathMap: Map<string, string>): ProviderAdapter {
  function normalizeLine(line: string, index: number): NormalizedMessage | null {
    if (!line.trim()) return null;
    let parsed: { type?: string; text?: string };
    try { parsed = JSON.parse(line); } catch { return null; }
    if (parsed.type !== "text" || !parsed.text) return null;
    return { role: "assistant", parts: [{ type: "text", text: parsed.text }], index };
  }

  return {
    name: "MockAdapter",
    id: "mock",
    async *run() { return { totalCostUsd: 0, numTurns: 0 }; },
    async getSessionHistory() { return []; },
    async getMessages(sessionId: string, options?: { before?: number; limit?: number }): Promise<PaginatedMessages> {
      const filePath = filePathMap.get(sessionId);
      if (!filePath) { const err = new Error("not found"); err.name = "SessionNotFound"; throw err; }
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(filePath, "utf-8");
      const allMessages: NormalizedMessage[] = [];
      let idx = 0;
      for (const line of content.split("\n")) {
        const msg = normalizeLine(line, idx);
        if (msg) { allMessages.push(msg); idx++; }
      }
      const limit = Math.min(options?.limit ?? 100, 100);
      const page = allMessages.slice(-limit);
      return { messages: page, tasks: [], totalMessages: allMessages.length, hasMore: false, oldestIndex: page[0]?.index ?? 0 };
    },
    async listSessions() { return []; },
    async getSessionFilePath(sessionId: string) { return filePathMap.get(sessionId) ?? null; },
    normalizeFileLine: normalizeLine,
  };
}

type MockWs = { readyState: number; send: (data: string) => void };

function createMockWs(): { ws: MockWs; sent: string[] } {
  const sent: string[] = [];
  return { ws: { readyState: 1, send(data: string) { sent.push(data); } } as MockWs, sent };
}

/** Create a JSONL file with one line for a session. */
async function createSessionFile(sessionId: string): Promise<string> {
  const filePath = join(subDir, `${sessionId}.jsonl`);
  await writeFile(filePath, JSON.stringify({ type: "text", text: `msg-${sessionId}` }) + "\n");
  return filePath;
}

beforeEach(async () => {
  subDir = join(testDir, `run-${++subDirCounter}`);
  await mkdir(subDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true }).catch(() => {});
});

// ── Tests ──

describe("SessionWatcher — LRU eviction", () => {
  it("evicts oldest idle sessions when cap is exceeded on subscribe", async () => {
    // Create 12 sessions, subscribe + unsubscribe to each (making them idle with messages)
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 12; i++) {
      const id = `sess-${i}`;
      fileMap.set(id, await createSessionFile(id));
    }
    // Add session 13 that will trigger eviction
    fileMap.set("sess-13", await createSessionFile("sess-13"));

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Subscribe + unsubscribe 12 sessions (leaves them idle with loaded messages)
    for (let i = 1; i <= 12; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
    }
    expect(watcher.watchedCount).toBe(12);

    // Subscribe to session 13 — triggers eviction
    const { ws: ws13 } = createMockWs();
    await watcher.subscribe("sess-13", ws13 as unknown as import("ws").WebSocket);

    // 10 idle (cap) + 1 with active client (sess-13) = 11
    expect(watcher.watchedCount).toBe(11);

    watcher.stop();
  });

  it("does not evict sessions with connected WS clients", async () => {
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 12; i++) {
      fileMap.set(`sess-${i}`, await createSessionFile(`sess-${i}`));
    }

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Keep WS clients connected for sessions 1-11
    const connectedWs: MockWs[] = [];
    for (let i = 1; i <= 11; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      connectedWs.push(ws);
    }

    // Subscribe + unsubscribe session 12 (idle)
    const { ws: ws12 } = createMockWs();
    await watcher.subscribe("sess-12", ws12 as unknown as import("ws").WebSocket);
    watcher.unsubscribe("sess-12", ws12 as unknown as import("ws").WebSocket);

    // All 12 should remain — 11 have clients, 1 idle is under cap
    expect(watcher.watchedCount).toBe(12);

    watcher.stop();
  });

  it("does not evict sessions in push mode", async () => {
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 12; i++) {
      fileMap.set(`sess-${i}`, await createSessionFile(`sess-${i}`));
    }

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Put session 1 in push mode (simulates runSession)
    watcher.setMode("sess-1", "push");

    // Subscribe + unsubscribe sessions 2-12 (idle)
    for (let i = 2; i <= 12; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
    }

    // Subscribe session 13 to trigger eviction check
    fileMap.set("sess-13", await createSessionFile("sess-13"));
    const { ws: ws13 } = createMockWs();
    await watcher.subscribe("sess-13", ws13 as unknown as import("ws").WebSocket);

    // sess-1 (push, not evictable) + 10 idle (cap) + sess-13 (has client) = 12
    expect(watcher.watchedCount).toBe(12);

    watcher.stop();
  });

  it("evicts the least recently accessed sessions first", async () => {
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 12; i++) {
      fileMap.set(`sess-${i}`, await createSessionFile(`sess-${i}`));
    }

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Subscribe sessions 1-11 in order, unsubscribe each
    for (let i = 1; i <= 11; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
    }

    // Re-subscribe to sess-1 to make it most recently accessed, then unsubscribe
    const { ws: wsRefresh } = createMockWs();
    await watcher.subscribe("sess-1", wsRefresh as unknown as import("ws").WebSocket);
    watcher.unsubscribe("sess-1", wsRefresh as unknown as import("ws").WebSocket);

    // Subscribe session 12 — triggers eviction, sess-2 should be evicted (oldest)
    const { ws: ws12 } = createMockWs();
    await watcher.subscribe("sess-12", ws12 as unknown as import("ws").WebSocket);

    // 10 idle + 1 with client = 11
    expect(watcher.watchedCount).toBe(11);

    // Verify sess-2 was evicted by re-subscribing — should re-read from file
    const { ws: wsReload, sent: sentReload } = createMockWs();
    await watcher.subscribe("sess-2", wsReload as unknown as import("ws").WebSocket);
    // The message should be loaded from file (not from memory cache)
    const messages = sentReload
      .map((s) => JSON.parse(s))
      .filter((e: { type: string }) => e.type === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0].message.parts[0].text).toBe("msg-sess-2");

    watcher.stop();
  });

  it("pushMessage updates lastAccessedAt preventing eviction", async () => {
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 12; i++) {
      fileMap.set(`sess-${i}`, await createSessionFile(`sess-${i}`));
    }

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Subscribe + unsubscribe sessions 1-11
    for (let i = 1; i <= 11; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
    }

    // Put sess-1 in push mode and send a message (updates lastAccessedAt)
    watcher.setMode("sess-1", "push");
    watcher.pushMessage("sess-1", {
      role: "assistant",
      parts: [{ type: "text", text: "alive" }],
      index: 0,
    });
    // Return to idle (but lastAccessedAt is now recent)
    watcher.setMode("sess-1", "idle");

    // Subscribe session 12 — triggers eviction, sess-1 should survive (recently accessed)
    fileMap.set("sess-12", await createSessionFile("sess-12"));
    const { ws: ws12 } = createMockWs();
    await watcher.subscribe("sess-12", ws12 as unknown as import("ws").WebSocket);

    // sess-2 should be evicted (oldest), not sess-1
    expect(watcher.watchedCount).toBe(11);

    watcher.stop();
  });

  it("forceRemove still works unconditionally", async () => {
    const fileMap = new Map<string, string>();
    fileMap.set("sess-1", await createSessionFile("sess-1"));

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    const { ws } = createMockWs();
    await watcher.subscribe("sess-1", ws as unknown as import("ws").WebSocket);
    expect(watcher.watchedCount).toBe(1);

    // forceRemove ignores client count and mode
    watcher.forceRemove("sess-1");
    expect(watcher.watchedCount).toBe(0);

    watcher.stop();
  });

  it("remap preserves lastAccessedAt (no eviction of remapped session)", async () => {
    const fileMap = new Map<string, string>();
    for (let i = 1; i <= 11; i++) {
      fileMap.set(`sess-${i}`, await createSessionFile(`sess-${i}`));
    }

    const adapter = createMockAdapter(fileMap);
    const { watcher } = createWatcherWithDeps(adapter);

    // Subscribe + unsubscribe sessions 1-11
    for (let i = 1; i <= 11; i++) {
      const { ws } = createMockWs();
      await watcher.subscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(`sess-${i}`, ws as unknown as import("ws").WebSocket);
    }

    // Remap sess-11 to a new ID — should preserve its lastAccessedAt
    watcher.remap("sess-11", "sess-11-real");
    fileMap.set("sess-11-real", fileMap.get("sess-11")!);

    // Subscribe sessions 12 and 13 to force eviction past cap
    for (const id of ["sess-12", "sess-13"]) {
      fileMap.set(id, await createSessionFile(id));
      const { ws } = createMockWs();
      await watcher.subscribe(id, ws as unknown as import("ws").WebSocket);
      watcher.unsubscribe(id, ws as unknown as import("ws").WebSocket);
    }

    // sess-11-real should survive (was most recent before remap)
    // sess-1 and sess-2 should be evicted (oldest)
    expect(watcher.watchedCount).toBe(11);

    watcher.stop();
  });
});

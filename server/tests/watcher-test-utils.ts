/**
 * Shared test utilities for SessionWatcher unit tests.
 * Used by session-watcher.test.ts, session-watcher-lru.test.ts,
 * and session-watcher-context.test.ts.
 */
import { readFile } from "node:fs/promises";
import type { NormalizedMessage, ProviderAdapter, PaginatedMessages } from "../src/providers/types.js";

export type MockWs = { readyState: number; send: (data: string) => void };

/** Mock WebSocket with readyState and send() that records serialized frames. */
export function createMockWs(): { ws: MockWs; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: 1, // OPEN
    send(data: string) {
      sent.push(data);
    },
  } as MockWs;
  return { ws, sent };
}

/**
 * Mock adapter backed by a Map<sessionId, filePath>.
 * Parses `{"type":"text","text":"..."}` JSONL lines.
 * Supports `before` and `limit` pagination options in getMessages().
 */
export function createFilePathMockAdapter(filePathMap: Map<string, string>): ProviderAdapter {
  function normalizeLine(line: string, index: number): NormalizedMessage | null {
    if (!line.trim()) return null;
    let parsed: { type?: string; text?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (parsed.type !== "text" || !parsed.text) return null;
    return {
      role: "assistant",
      parts: [{ type: "text", text: parsed.text }],
      index,
    };
  }

  return {
    name: "MockAdapter",
    id: "mock",
    async *run(): AsyncGenerator<NormalizedMessage, { providerSessionId?: string; totalCostUsd: number; numTurns: number }, undefined> {
      return { totalCostUsd: 0, numTurns: 0 };
    },
    async getSessionHistory(): Promise<NormalizedMessage[]> {
      return [];
    },
    async getMessages(sessionId: string, options?: { before?: number; limit?: number }): Promise<PaginatedMessages> {
      const filePath = filePathMap.get(sessionId);
      if (!filePath) {
        const err = new Error(`Session file not found for ${sessionId}`);
        err.name = "SessionNotFound";
        throw err;
      }
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return { messages: [], tasks: [], totalMessages: 0, hasMore: false, oldestIndex: 0 };
        }
        throw err;
      }
      const allMessages: NormalizedMessage[] = [];
      let idx = 0;
      for (const line of content.split("\n")) {
        const msg = normalizeLine(line, idx);
        if (msg) { allMessages.push(msg); idx++; }
      }
      const before = options?.before ?? allMessages.length;
      const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
      const eligible = allMessages.filter((m) => m.index < before);
      const page = eligible.slice(-limit);
      const oldestIndex = page.length > 0 ? page[0].index : 0;
      const hasMore = eligible.length > page.length;
      return { messages: page, tasks: [], totalMessages: allMessages.length, hasMore, oldestIndex };
    },
    async listSessions() {
      return [];
    },
    async getSessionFilePath(sessionId: string): Promise<string | null> {
      return filePathMap.get(sessionId) ?? null;
    },
    normalizeFileLine: normalizeLine,
  };
}

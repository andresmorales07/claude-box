import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const testDir = join(tmpdir(), `hatchpod-history-msg-test-${Date.now()}`);
const fakeClaudeDir = join(testDir, ".claude", "projects");
const fakeProjectDir = join(fakeClaudeDir, "-home-user-workspace");

let ClaudeAdapter: typeof import("../src/providers/claude-adapter.js").ClaudeAdapter;

beforeAll(async () => {
  process.env.CLAUDE_PROJECTS_DIR = fakeClaudeDir;
  await mkdir(fakeProjectDir, { recursive: true });
  const mod = await import("../src/providers/claude-adapter.js");
  ClaudeAdapter = mod.ClaudeAdapter;
});

afterAll(async () => {
  delete process.env.CLAUDE_PROJECTS_DIR;
  await rm(testDir, { recursive: true, force: true });
});

function makeFullJsonl(sessionId: string): string {
  const lines: string[] = [];
  // Progress line (should be skipped)
  lines.push(JSON.stringify({
    type: "progress",
    sessionId,
    cwd: "/home/user/workspace",
    timestamp: "2026-02-20T10:00:00.000Z",
  }));
  // User message with string content
  lines.push(JSON.stringify({
    type: "user",
    sessionId,
    message: {
      role: "user",
      content: "Hello, how are you?",
    },
    timestamp: "2026-02-20T10:00:01.000Z",
  }));
  // Assistant message with text
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId,
    message: {
      role: "assistant",
      type: "message",
      content: [
        { type: "text", text: "I'm doing well, thanks!" },
      ],
    },
    timestamp: "2026-02-20T10:00:02.000Z",
  }));
  // User message with tool_result content
  lines.push(JSON.stringify({
    type: "user",
    sessionId,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_123", content: "file content here", is_error: false },
      ],
    },
    timestamp: "2026-02-20T10:00:03.000Z",
  }));
  // Assistant with tool_use
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId,
    message: {
      role: "assistant",
      type: "message",
      content: [
        { type: "tool_use", id: "tu_456", name: "Read", input: { path: "/tmp/test" } },
      ],
    },
    timestamp: "2026-02-20T10:00:04.000Z",
  }));
  // file-history-snapshot (should be skipped)
  lines.push(JSON.stringify({
    type: "file-history-snapshot",
    sessionId,
  }));
  return lines.join("\n") + "\n";
}

describe("ClaudeAdapter.getSessionHistory", () => {
  it("parses user and assistant messages from JSONL", async () => {
    const sid = randomUUID();
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), makeFullJsonl(sid));

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);

    // Should have 4 messages: user text, assistant text, user tool_result, assistant tool_use
    expect(messages).toHaveLength(4);

    // First: user text
    expect(messages[0].role).toBe("user");
    expect(messages[0].parts).toEqual([{ type: "text", text: "Hello, how are you?" }]);

    // Second: assistant text
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts).toEqual([{ type: "text", text: "I'm doing well, thanks!" }]);

    // Third: user tool_result
    expect(messages[2].role).toBe("user");
    expect(messages[2].parts[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_123",
      output: "file content here",
      isError: false,
    });

    // Fourth: assistant tool_use
    expect(messages[3].role).toBe("assistant");
    expect(messages[3].parts[0]).toMatchObject({
      type: "tool_use",
      toolUseId: "tu_456",
      toolName: "Read",
    });
  });

  it("throws SessionNotFound for nonexistent session", async () => {
    const adapter = new ClaudeAdapter();
    await expect(adapter.getSessionHistory!(randomUUID())).rejects.toThrow(/Session file not found/);
  });

  it("indexes messages sequentially", async () => {
    const sid = randomUUID();
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), makeFullJsonl(sid));

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);
    messages.forEach((m, i) => expect(m.index).toBe(i));
  });

  it("skips isMeta user messages", async () => {
    const sid = randomUUID();
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: sid,
        isMeta: true,
        message: { role: "user", content: "System injected context" },
        timestamp: "2026-02-20T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "user",
        sessionId: sid,
        message: { role: "user", content: "Real user message" },
        timestamp: "2026-02-20T10:00:01.000Z",
      }),
    ].join("\n") + "\n";
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), lines);

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ type: "text", text: "Real user message" }]);
  });

  it("skips isSynthetic user messages", async () => {
    const sid = randomUUID();
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: sid,
        isSynthetic: true,
        message: { role: "user", content: "Synthetic content" },
        timestamp: "2026-02-20T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: sid,
        message: { role: "assistant", type: "message", content: [{ type: "text", text: "Response" }] },
        timestamp: "2026-02-20T10:00:01.000Z",
      }),
    ].join("\n") + "\n";
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), lines);

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
  });

  it("strips system-reminder tags from user message text", async () => {
    const sid = randomUUID();
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: sid,
        message: {
          role: "user",
          content: "<system-reminder>Hidden context</system-reminder>Fix the login bug",
        },
        timestamp: "2026-02-20T10:00:00.000Z",
      }),
    ].join("\n") + "\n";
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), lines);

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ type: "text", text: "Fix the login bug" }]);
  });

  it("converts slash-command markup to clean form", async () => {
    const sid = randomUUID();
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: sid,
        message: {
          role: "user",
          content: "<command-name>/commit</command-name><command-args>fix: resolve race condition</command-args>",
        },
        timestamp: "2026-02-20T10:00:00.000Z",
      }),
    ].join("\n") + "\n";
    await writeFile(join(fakeProjectDir, `${sid}.jsonl`), lines);

    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory!(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ type: "text", text: "/commit fix: resolve race condition" }]);
  });
});

describe("ClaudeAdapter.normalizeFileLine", () => {
  it("returns null for empty string", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.normalizeFileLine("", 0)).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.normalizeFileLine("   \t  ", 0)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.normalizeFileLine("{not json", 0)).toBeNull();
  });

  it("returns null for non-user/assistant types", () => {
    const adapter = new ClaudeAdapter();
    const types = ["progress", "result", "file-history-snapshot"];
    for (const type of types) {
      const line = JSON.stringify({ type, sessionId: "abc" });
      expect(adapter.normalizeFileLine(line, 0)).toBeNull();
    }
  });

  it("returns null for isMeta user line", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({
      type: "user",
      isMeta: true,
      message: { role: "user", content: "meta content" },
    });
    expect(adapter.normalizeFileLine(line, 0)).toBeNull();
  });

  it("returns null for isSynthetic user line", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({
      type: "user",
      isSynthetic: true,
      message: { role: "user", content: "synthetic content" },
    });
    expect(adapter.normalizeFileLine(line, 0)).toBeNull();
  });

  it("returns null for missing message field", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({ type: "user" });
    expect(adapter.normalizeFileLine(line, 0)).toBeNull();
  });

  it("preserves provided index parameter", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hello" },
    });
    const result = adapter.normalizeFileLine(line, 42);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(42);
  });

  it("normalizes a valid user message", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Test message" },
    });
    const result = adapter.normalizeFileLine(line, 0);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("user");
    expect(result!.parts).toEqual([{ type: "text", text: "Test message" }]);
  });

  it("normalizes a valid assistant message", () => {
    const adapter = new ClaudeAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        type: "message",
        content: [{ type: "text", text: "Response" }],
      },
    });
    const result = adapter.normalizeFileLine(line, 5);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("assistant");
    expect(result!.index).toBe(5);
    expect(result!.parts).toEqual([{ type: "text", text: "Response" }]);
  });
});

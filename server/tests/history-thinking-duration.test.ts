import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

let tmpDir: string;
let originalProjectsDir: string | undefined;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hatchpod-test-"));
  originalProjectsDir = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = tmpDir;
});

afterAll(async () => {
  if (originalProjectsDir !== undefined) {
    process.env.CLAUDE_PROJECTS_DIR = originalProjectsDir;
  } else {
    delete process.env.CLAUDE_PROJECTS_DIR;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

/** Write a JSONL session file and return its session ID. */
async function writeSession(lines: Record<string, unknown>[]): Promise<string> {
  const sessionId = randomUUID();
  const projectDir = join(tmpDir, "-test-project");
  await mkdir(projectDir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  await writeFile(join(projectDir, `${sessionId}.jsonl`), content, "utf-8");
  return sessionId;
}

describe("getSessionHistory — thinking duration from JSONL timestamps", () => {
  it("computes thinkingDurationMs for assistant messages with reasoning blocks", async () => {
    const sessionId = await writeSession([
      {
        type: "user",
        message: { role: "user", content: "hello" },
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me think about this." },
            { type: "text", text: "Here is my answer." },
          ],
        },
        timestamp: "2026-01-01T00:00:05.000Z",
      },
    ]);

    const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");
    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory(sessionId);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.role).toBe("assistant");
    if (assistant!.role === "assistant") {
      expect(assistant!.thinkingDurationMs).toBe(5000);
    }
  });

  it("does not set thinkingDurationMs for assistant messages without reasoning", async () => {
    const sessionId = await writeSession([
      {
        type: "user",
        message: { role: "user", content: "hello" },
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Just text, no thinking." }],
        },
        timestamp: "2026-01-01T00:00:02.000Z",
      },
    ]);

    const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");
    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory(sessionId);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    if (assistant!.role === "assistant") {
      expect(assistant!.thinkingDurationMs).toBeUndefined();
    }
  });

  it("uses the immediately preceding timestamp (including non-message lines)", async () => {
    // Simulate: user → system event (closer to assistant) → assistant with thinking
    // Duration should be measured from the system event, not the user message
    const sessionId = await writeSession([
      {
        type: "user",
        message: { role: "user", content: "run a tool" },
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "tool_use",
        tool: "Bash",
        timestamp: "2026-01-01T00:00:08.000Z",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Processing result..." },
            { type: "text", text: "Done." },
          ],
        },
        timestamp: "2026-01-01T00:00:10.000Z",
      },
    ]);

    const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");
    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory(sessionId);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    if (assistant!.role === "assistant") {
      // 10s - 8s = 2s (from the intermediate event, not the user message at 0s)
      expect(assistant!.thinkingDurationMs).toBe(2000);
    }
  });

  it("handles missing timestamps gracefully", async () => {
    const sessionId = await writeSession([
      {
        type: "user",
        message: { role: "user", content: "hello" },
        // no timestamp
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Thinking..." },
            { type: "text", text: "Answer." },
          ],
        },
        // no timestamp
      },
    ]);

    const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");
    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory(sessionId);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    if (assistant!.role === "assistant") {
      // No timestamps → can't compute duration
      expect(assistant!.thinkingDurationMs).toBeUndefined();
    }
  });

  it("handles multiple assistant messages with different thinking durations", async () => {
    const sessionId = await writeSession([
      {
        type: "user",
        message: { role: "user", content: "first question" },
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Short think." },
            { type: "text", text: "Answer 1." },
          ],
        },
        timestamp: "2026-01-01T00:00:03.000Z",
      },
      {
        type: "user",
        message: { role: "user", content: "second question" },
        timestamp: "2026-01-01T00:00:04.000Z",
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Longer think this time." },
            { type: "text", text: "Answer 2." },
          ],
        },
        timestamp: "2026-01-01T00:00:14.000Z",
      },
    ]);

    const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");
    const adapter = new ClaudeAdapter();
    const messages = await adapter.getSessionHistory(sessionId);

    const assistants = messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);

    if (assistants[0].role === "assistant") {
      expect(assistants[0].thinkingDurationMs).toBe(3000);
    }
    if (assistants[1].role === "assistant") {
      expect(assistants[1].thinkingDurationMs).toBe(10000);
    }
  });
});

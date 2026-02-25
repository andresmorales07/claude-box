import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderSessionOptions } from "../src/providers/types.js";

const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");

function createMockHandle(messages: Record<string, unknown>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) yield msg;
    },
    supportedCommands: () => Promise.resolve([]),
  };
}

function makeOptions(overrides: Partial<ProviderSessionOptions> = {}): ProviderSessionOptions {
  return {
    prompt: "test",
    cwd: "/tmp",
    permissionMode: "default",
    abortSignal: new AbortController().signal,
    onToolApproval: () => Promise.resolve({ allow: true as const }),
    ...overrides,
  };
}

describe("ClaudeAdapter subagent extraction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits onSubagentStarted for task_started system messages", async () => {
    const started: unknown[] = [];
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tu-1",
        description: "Find auth handlers",
        task_type: "Explore",
      },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onSubagentStarted: (info) => started.push(info),
    }));
    while (!(await gen.next()).done) {}

    expect(started).toEqual([{
      taskId: "task-1",
      toolUseId: "tu-1",
      description: "Find auth handlers",
      agentType: "Explore",
    }]);
  });

  it("emits onSubagentToolCall for sidechain assistant tool_use blocks", async () => {
    const toolCalls: unknown[] = [];
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "assistant",
        parent_tool_use_id: "tu-1",
        message: {
          content: [
            { type: "tool_use", id: "sub-tu-1", name: "Grep", input: { pattern: "auth" } },
            { type: "tool_use", id: "sub-tu-2", name: "Read", input: { file_path: "/src/auth.ts" } },
          ],
        },
      },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onSubagentToolCall: (info) => toolCalls.push(info),
    }));
    while (!(await gen.next()).done) {}

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({ toolUseId: "tu-1", toolName: "Grep" });
    expect(toolCalls[1]).toMatchObject({ toolUseId: "tu-1", toolName: "Read" });
  });

  it("emits onSubagentCompleted for task_notification system messages", async () => {
    const completed: unknown[] = [];
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tu-1",
        description: "Find files",
        task_type: "Explore",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        output_file: "/tmp/out.txt",
        summary: "Found 3 auth handler functions",
      },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onSubagentStarted: () => {},
      onSubagentCompleted: (info) => completed.push(info),
    }));
    while (!(await gen.next()).done) {}

    expect(completed).toEqual([{
      taskId: "task-1",
      toolUseId: "tu-1",
      status: "completed",
      summary: "Found 3 auth handler functions",
    }]);
  });

  it("does not yield sidechain messages as NormalizedMessage", async () => {
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "assistant",
        parent_tool_use_id: "tu-1",
        message: { content: [{ type: "text", text: "sidechain text" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "parent text" }] },
      },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions());
    const messages = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      messages.push(next.value);
    }

    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
  });

  it("filters sidechain thinking deltas from stream_event", async () => {
    const deltas: string[] = [];
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "stream_event",
        parent_tool_use_id: "tu-1",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "sidechain thinking" },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "parent thinking" },
        },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "done" }] },
      },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onThinkingDelta: (text) => deltas.push(text),
    }));
    while (!(await gen.next()).done) {}

    expect(deltas).toEqual(["parent thinking"]);
  });

  it("handles full subagent lifecycle (started → tool calls → completed)", async () => {
    const started: unknown[] = [];
    const toolCalls: unknown[] = [];
    const completed: unknown[] = [];

    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tu-1",
        description: "Explore codebase",
        task_type: "Explore",
      },
      {
        type: "assistant",
        parent_tool_use_id: "tu-1",
        message: {
          content: [{ type: "tool_use", id: "sub-1", name: "Glob", input: { pattern: "**/*.ts" } }],
        },
      },
      {
        type: "assistant",
        parent_tool_use_id: "tu-1",
        message: {
          content: [{ type: "tool_use", id: "sub-2", name: "Read", input: { file_path: "/src/index.ts" } }],
        },
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: "Found the entry point",
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Done exploring." }] },
      },
      { type: "result", total_cost_usd: 0.05, num_turns: 1 },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onSubagentStarted: (info) => started.push(info),
      onSubagentToolCall: (info) => toolCalls.push(info),
      onSubagentCompleted: (info) => completed.push(info),
    }));

    const messages = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      messages.push(next.value);
    }

    expect(started).toHaveLength(1);
    expect(toolCalls).toHaveLength(2);
    expect(completed).toHaveLength(1);
    // Only the parent assistant message should be yielded
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

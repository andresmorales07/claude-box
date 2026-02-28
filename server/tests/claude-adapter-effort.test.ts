import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderSessionOptions } from "../src/providers/types.js";

/**
 * Mock the Claude Agent SDK so ClaudeAdapter.run() processes our
 * synthetic stream_event / assistant messages instead of hitting the real API.
 * Captures all calls to query() so tests can inspect the options passed.
 */
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import adapter AFTER the mock is in place
const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");

/** Create a mock query handle (async iterable + supportedCommands). */
function createMockHandle(messages: Record<string, unknown>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
    supportedCommands: () => Promise.resolve([]),
  };
}

/** Minimal message sequence that satisfies the adapter's result handling. */
const minimalMessages = [
  {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Done." }],
    },
  },
  {
    type: "result",
    total_cost_usd: 0,
    num_turns: 1,
    session_id: "test-session-id",
  },
];

/** Minimal ProviderSessionOptions for testing. */
function makeOptions(overrides: Partial<ProviderSessionOptions> = {}): ProviderSessionOptions {
  return {
    prompt: "test prompt",
    cwd: "/tmp",
    permissionMode: "default",
    abortSignal: new AbortController().signal,
    onToolApproval: () => Promise.resolve({ allow: true as const }),
    ...overrides,
  };
}

/** Drain the adapter generator completely and return the final result. */
async function drainAdapter(options: ProviderSessionOptions) {
  const adapter = new ClaudeAdapter();
  const gen = adapter.run(options);
  for (;;) {
    const next = await gen.next();
    if (next.done) return next.value;
  }
}

describe("ClaudeAdapter effort option passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes effort: "low" to sdkQuery when options.effort is "low"', async () => {
    mockQuery.mockReturnValue(createMockHandle(minimalMessages));

    await drainAdapter(makeOptions({ effort: "low" }));

    expect(mockQuery).toHaveBeenCalledOnce();
    const call = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
  });

  it("does not pass effort to sdkQuery when options.effort is not set", async () => {
    mockQuery.mockReturnValue(createMockHandle(minimalMessages));

    await drainAdapter(makeOptions());

    expect(mockQuery).toHaveBeenCalledOnce();
    const call = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBeUndefined();
  });

  it('passes effort: "max" to sdkQuery when options.effort is "max"', async () => {
    mockQuery.mockReturnValue(createMockHandle(minimalMessages));

    await drainAdapter(makeOptions({ effort: "max" }));

    expect(mockQuery).toHaveBeenCalledOnce();
    const call = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("max");
  });
});

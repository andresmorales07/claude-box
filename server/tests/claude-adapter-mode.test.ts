import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock must be at top level before any imports that use the module
vi.mock("@anthropic-ai/claude-agent-sdk");

import { ClaudeAdapter } from "../src/providers/claude-adapter.js";
import { query as mockQuery } from "@anthropic-ai/claude-agent-sdk";

describe("ClaudeAdapter.modeTransitionTools", () => {
  it("contains ExitPlanMode → default", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.modeTransitionTools.get("ExitPlanMode")).toBe("default");
  });

  it("contains EnterPlanMode → plan", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.modeTransitionTools.get("EnterPlanMode")).toBe("plan");
  });
});

describe("ClaudeAdapter onModeChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onModeChanged('default') when ExitPlanMode is approved", async () => {
    // Capture canUseTool from the query options
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { toolUseID: string; suggestions?: unknown[] }) => Promise<unknown>) | undefined;

    const mockHandle = {
      [Symbol.asyncIterator]: async function* () { /* empty */ },
      supportedCommands: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(mockQuery).mockImplementation((opts: any) => {
      capturedCanUseTool = opts.options?.canUseTool;
      return mockHandle as any;
    });

    const adapter = new ClaudeAdapter();
    const onModeChanged = vi.fn();
    const abortController = new AbortController();

    const gen = adapter.run({
      prompt: "test",
      cwd: "/tmp",
      permissionMode: "plan",
      abortSignal: abortController.signal,
      onToolApproval: async () => ({ allow: true as const }),
      onModeChanged,
    });

    // Drain the generator
    for await (const _ of gen) { /* empty */ }

    // Simulate ExitPlanMode being approved
    expect(capturedCanUseTool).toBeDefined();
    await capturedCanUseTool!("ExitPlanMode", {}, { toolUseID: "tu1", suggestions: [] });

    expect(onModeChanged).toHaveBeenCalledWith("default");
    expect(onModeChanged).toHaveBeenCalledTimes(1);
  });

  it("calls onModeChanged('plan') when EnterPlanMode is approved", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { toolUseID: string; suggestions?: unknown[] }) => Promise<unknown>) | undefined;

    const mockHandle = {
      [Symbol.asyncIterator]: async function* () { /* empty */ },
      supportedCommands: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(mockQuery).mockImplementation((opts: any) => {
      capturedCanUseTool = opts.options?.canUseTool;
      return mockHandle as any;
    });

    const adapter = new ClaudeAdapter();
    const onModeChanged = vi.fn();
    const abortController = new AbortController();

    const gen = adapter.run({
      prompt: "test",
      cwd: "/tmp",
      permissionMode: "default",
      abortSignal: abortController.signal,
      onToolApproval: async () => ({ allow: true as const }),
      onModeChanged,
    });

    for await (const _ of gen) { /* empty */ }

    expect(capturedCanUseTool).toBeDefined();
    await capturedCanUseTool!("EnterPlanMode", {}, { toolUseID: "tu2", suggestions: [] });

    expect(onModeChanged).toHaveBeenCalledWith("plan");
  });

  it("does not call onModeChanged when a mode-transition tool is denied", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { toolUseID: string; suggestions?: unknown[] }) => Promise<unknown>) | undefined;

    const mockHandle = {
      [Symbol.asyncIterator]: async function* () { /* empty */ },
      supportedCommands: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(mockQuery).mockImplementation((opts: any) => {
      capturedCanUseTool = opts.options?.canUseTool;
      return mockHandle as any;
    });

    const adapter = new ClaudeAdapter();
    const onModeChanged = vi.fn();

    const gen = adapter.run({
      prompt: "test",
      cwd: "/tmp",
      permissionMode: "plan",
      abortSignal: new AbortController().signal,
      onToolApproval: async () => ({ allow: false as const }),
      onModeChanged,
    });

    for await (const _ of gen) { /* empty */ }

    expect(capturedCanUseTool).toBeDefined();
    await capturedCanUseTool!("ExitPlanMode", {}, { toolUseID: "tu-deny", suggestions: [] });

    expect(onModeChanged).not.toHaveBeenCalled();
  });

  it("does not call onModeChanged for other tools", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { toolUseID: string; suggestions?: unknown[] }) => Promise<unknown>) | undefined;

    const mockHandle = {
      [Symbol.asyncIterator]: async function* () { /* empty */ },
      supportedCommands: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(mockQuery).mockImplementation((opts: any) => {
      capturedCanUseTool = opts.options?.canUseTool;
      return mockHandle as any;
    });

    const adapter = new ClaudeAdapter();
    const onModeChanged = vi.fn();

    const gen = adapter.run({
      prompt: "test",
      cwd: "/tmp",
      permissionMode: "default",
      abortSignal: new AbortController().signal,
      onToolApproval: async () => ({ allow: true as const }),
      onModeChanged,
    });

    for await (const _ of gen) { /* empty */ }

    expect(capturedCanUseTool).toBeDefined();
    await capturedCanUseTool!("Bash", { command: "echo hi" }, { toolUseID: "tu3" });

    expect(onModeChanged).not.toHaveBeenCalled();
  });
});

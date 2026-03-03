import { describe, it, expect } from "vitest";
import {
  CommandHookSchema,
  HttpHookSchema,
  HookHandlerSchema,
  MatcherGroupSchema,
  HookConfigSchema,
  HOOK_EVENT_NAMES,
} from "../src/schemas/claude-hooks.js";

describe("CommandHookSchema", () => {
  it("accepts valid command hook", () => {
    const result = CommandHookSchema.safeParse({
      type: "command",
      command: "echo hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts command hook with all optional fields", () => {
    const result = CommandHookSchema.safeParse({
      type: "command",
      command: "lint.sh",
      timeout: 30,
      async: true,
      statusMessage: "Linting...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty command", () => {
    const result = CommandHookSchema.safeParse({
      type: "command",
      command: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative timeout", () => {
    const result = CommandHookSchema.safeParse({
      type: "command",
      command: "echo",
      timeout: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("HttpHookSchema", () => {
  it("accepts valid HTTP hook", () => {
    const result = HttpHookSchema.safeParse({
      type: "http",
      url: "https://example.com/hook",
    });
    expect(result.success).toBe(true);
  });

  it("accepts HTTP hook with headers and allowedEnvVars", () => {
    const result = HttpHookSchema.safeParse({
      type: "http",
      url: "http://localhost:3000/hook",
      headers: { Authorization: "Bearer $TOKEN" },
      allowedEnvVars: ["TOKEN"],
      timeout: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = HttpHookSchema.safeParse({
      type: "http",
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("HookHandlerSchema (discriminated union)", () => {
  it("dispatches to command hook", () => {
    const result = HookHandlerSchema.safeParse({
      type: "command",
      command: "echo hi",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("command");
  });

  it("dispatches to HTTP hook", () => {
    const result = HookHandlerSchema.safeParse({
      type: "http",
      url: "https://example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("http");
  });

  it("rejects unknown type", () => {
    const result = HookHandlerSchema.safeParse({
      type: "prompt",
      prompt: "Evaluate this",
    });
    expect(result.success).toBe(false);
  });
});

describe("MatcherGroupSchema", () => {
  it("accepts group with matcher", () => {
    const result = MatcherGroupSchema.safeParse({
      matcher: "Bash|Edit",
      hooks: [{ type: "command", command: "lint.sh" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts group without matcher (match all)", () => {
    const result = MatcherGroupSchema.safeParse({
      hooks: [{ type: "http", url: "https://example.com" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("HookConfigSchema", () => {
  it("accepts valid config with multiple events", () => {
    const config = {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command" as const, command: "tsc --noEmit" }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: "http" as const, url: "https://slack.com/webhook" }],
        },
      ],
    };
    const result = HookConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("accepts empty config", () => {
    const result = HookConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects unknown event name", () => {
    const result = HookConfigSchema.safeParse({
      UnknownEvent: [{ hooks: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("knows all 17 event names", () => {
    expect(HOOK_EVENT_NAMES).toHaveLength(17);
  });
});

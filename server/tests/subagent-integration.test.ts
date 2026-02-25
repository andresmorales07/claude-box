import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, resetSessions, api, connectWs, collectMessages } from "./helpers.js";
import type { ServerMessage } from "../src/types.js";

beforeAll(async () => {
  await startServer();
  await resetSessions();
});
afterAll(async () => { await stopServer(); });

describe("Subagent live summary integration", () => {
  it("broadcasts subagent_started, subagent_tool_call, subagent_completed via WebSocket", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json();

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "[subagent] test" }));

    const messages = await collectMessages(ws, (m) =>
      m.type === "status" && (m as ServerMessage & { status: string }).status === "completed",
    );

    const started = messages.filter((m) => m.type === "subagent_started");
    const toolCalls = messages.filter((m) => m.type === "subagent_tool_call");
    const completed = messages.filter((m) => m.type === "subagent_completed");

    expect(started).toHaveLength(1);
    expect((started[0] as any).toolUseId).toBeTruthy();
    expect((started[0] as any).agentType).toBe("Explore");

    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect((toolCalls[0] as any).toolName).toBeTruthy();

    expect(completed).toHaveLength(1);
    expect((completed[0] as any).status).toBe("completed");

    ws.close();
  });

  it("replays active subagent state to late-connecting subscriber", async () => {
    // Create session with immediate prompt — subagent events fire before WS connects
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test", prompt: "[subagent-slow] test" }),
    });
    const { id } = await createRes.json();

    // Small delay to let subagent events buffer (subagent-slow starts immediately,
    // then waits 200ms before first tool call)
    await new Promise((r) => setTimeout(r, 100));

    const ws = await connectWs(id);
    const messages = await collectMessages(ws, (m) =>
      m.type === "status" && (m as ServerMessage & { status: string }).status === "completed",
    );

    // Should receive subagent events during replay
    const started = messages.filter((m) => m.type === "subagent_started");
    expect(started.length).toBeGreaterThanOrEqual(1);

    ws.close();
  });
});

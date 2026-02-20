import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, resetSessions, api, connectWs, collectMessages, waitForStatus } from "./helpers.js";
import type { ServerMessage } from "../src/types.js";

beforeAll(async () => {
  await startServer();
  await resetSessions();
});

afterAll(async () => {
  await stopServer();
});

describe("Thinking Deltas", () => {
  it("broadcasts thinking_delta frames via WebSocket", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json();

    const ws = await connectWs(id);
    // Wait for replay_complete (idle session, no messages yet)
    await collectMessages(ws, (m) => m.type === "replay_complete");

    // Now send a prompt that triggers thinking
    ws.send(JSON.stringify({ type: "prompt", text: "[thinking] test" }));

    // Collect messages until completion
    const messages = await collectMessages(ws, (m) =>
      m.type === "status" && (m as ServerMessage & { status: string }).status === "completed",
    );

    // Should have thinking_delta frames
    const thinkingDeltas = messages.filter((m) => m.type === "thinking_delta") as Array<{ type: string; text: string }>;
    expect(thinkingDeltas.length).toBeGreaterThanOrEqual(1);
    // Check that deltas contain expected text fragments
    const allText = thinkingDeltas.map((d) => d.text).join("");
    expect(allText).toContain("analyze this");

    // Should also have the complete message with reasoning part
    const msgEvents = messages.filter((m) => m.type === "message") as Array<{ type: string; message: { role: string; parts: Array<{ type: string; text?: string }> } }>;
    const assistantMsg = msgEvents.find((m) => m.message.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const reasoningPart = assistantMsg!.message.parts.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();

    ws.close();
  });

  it("includes reasoning part in REST session response", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ prompt: "[thinking] test", provider: "test" }),
    });
    const { id } = await createRes.json();

    const session = await waitForStatus(id, "completed") as {
      messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
    };

    const assistantMsg = session.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const reasoningPart = assistantMsg!.parts.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart!.text).toContain("analyze this request carefully");
  });
});

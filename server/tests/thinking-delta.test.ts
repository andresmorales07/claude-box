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
  it("broadcasts thinking_delta frames via WebSocket with correct ordering and content", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json();

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "[thinking] test" }));

    const messages = await collectMessages(ws, (m) =>
      m.type === "status" && (m as ServerMessage & { status: string }).status === "completed",
    );

    // Should have exactly 3 thinking_delta frames (one per test adapter emission)
    const thinkingDeltas = messages.filter((m) => m.type === "thinking_delta") as Array<{ type: string; text: string }>;
    expect(thinkingDeltas).toHaveLength(3);

    // Every delta should have a non-empty text field
    expect(thinkingDeltas.every((d) => d.text.length > 0)).toBe(true);

    // Concatenated deltas should exactly match the final reasoning part
    const allDeltaText = thinkingDeltas.map((d) => d.text).join("");
    expect(allDeltaText).toBe("I need to analyze this request carefully.");

    // All thinking_delta frames must arrive before the assistant message
    const lastDeltaIndex = messages.reduce(
      (max, m, i) => (m.type === "thinking_delta" ? i : max), -1,
    );
    const firstMsgIndex = messages.findIndex(
      (m) => m.type === "message" && (m as { message: { role: string } }).message.role === "assistant",
    );
    expect(lastDeltaIndex).toBeLessThan(firstMsgIndex);

    // The complete message should contain a reasoning part with matching text
    const msgEvents = messages.filter((m) => m.type === "message") as Array<{ type: string; message: { role: string; parts: Array<{ type: string; text?: string }> } }>;
    const assistantMsg = msgEvents.find((m) => m.message.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const reasoningPart = assistantMsg!.message.parts.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart!.text).toBe(allDeltaText);

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
    expect(reasoningPart!.text).toBe("I need to analyze this request carefully.");
  });

  it("does not emit thinking_delta frames for non-thinking prompts", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json();

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "Hello world" }));

    const messages = await collectMessages(ws, (m) =>
      m.type === "status" && (m as ServerMessage & { status: string }).status === "completed",
    );

    const thinkingDeltas = messages.filter((m) => m.type === "thinking_delta");
    expect(thinkingDeltas).toHaveLength(0);

    // Should still have a normal assistant message
    const msgEvents = messages.filter((m) => m.type === "message") as Array<{ type: string; message: { role: string } }>;
    expect(msgEvents.some((m) => m.message.role === "assistant")).toBe(true);

    ws.close();
  });

  it("does not replay thinking_delta on late WebSocket connection", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ prompt: "[thinking] test", provider: "test" }),
    });
    const { id } = await createRes.json();

    // Wait for the session to complete before connecting
    await waitForStatus(id, "completed");

    const ws = await connectWs(id);
    const messages = await collectMessages(ws, (m) => m.type === "replay_complete");

    // No thinking_delta frames should be in the replay
    const thinkingDeltas = messages.filter((m) => m.type === "thinking_delta");
    expect(thinkingDeltas).toHaveLength(0);

    // But the reasoning part should be present in the replayed message
    const msgEvents = messages.filter((m) => m.type === "message") as Array<{ type: string; message: { role: string; parts: Array<{ type: string; text?: string }> } }>;
    const assistantMsg = msgEvents.find((m) => m.message.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.message.parts.some((p) => p.type === "reasoning")).toBe(true);

    ws.close();
  });
});

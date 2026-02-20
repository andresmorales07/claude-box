import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, api, connectWs, collectMessages, waitForStatus } from "./helpers.js";
import type { ServerMessage } from "../src/types.js";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

describe("Follow-up Messages", () => {
  it("sends a follow-up to an idle session", async () => {
    // Create idle session (no prompt)
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const createBody = await createRes.json() as { id: string; status: string };
    const id = createBody.id;
    expect(createBody.status).toBe("idle");

    // Connect WS and send prompt
    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "First message" }));

    // Wait for completion
    const messages = await collectMessages(ws, (msg) =>
      msg.type === "status" && (msg as ServerMessage & { status: string }).status === "completed",
    );

    // Should have the echo response
    const msgEvents = messages.filter((m) => m.type === "message");
    expect(msgEvents.length).toBeGreaterThanOrEqual(1);

    const lastMsgEvent = msgEvents[msgEvents.length - 1] as ServerMessage & {
      message: { parts: Array<{ type: string; text?: string }> };
    };
    const textPart = lastMsgEvent.message.parts.find((p) => p.type === "text");
    expect(textPart?.text).toBe("Echo: First message");

    ws.close();
  });

  it("sends a second follow-up after completion", async () => {
    // Create session with initial prompt
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ prompt: "First", provider: "test" }),
    });
    const { id } = await createRes.json();

    // Wait for first to complete
    await waitForStatus(id, "completed");

    // Connect WS and send follow-up
    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "Second message" }));

    // Wait for second completion
    const messages = await collectMessages(ws, (msg) =>
      msg.type === "status" && (msg as ServerMessage & { status: string }).status === "completed",
    );

    // Should get the second echo
    const msgEvents = messages.filter((m) => m.type === "message");
    expect(msgEvents.length).toBeGreaterThanOrEqual(1);

    // Verify via REST that all messages are there
    const detailRes = await api(`/api/sessions/${id}`);
    const session = await detailRes.json() as { messages: Array<{ role: string }> };
    // At least 2 messages: one from first prompt, one from follow-up
    expect(session.messages.length).toBeGreaterThanOrEqual(2);

    ws.close();
  });
});

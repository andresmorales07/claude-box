import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startServer, stopServer, resetSessions, api, connectWs, collectMessages, waitForStatus } from "./helpers.js";
import type { ServerMessage } from "../src/types.js";

type StatusMsg = ServerMessage & { status: string };
type ModeMsg = ServerMessage & { mode: string };
type ErrMsg = ServerMessage & { message: string };

const isTerminalStatus = (m: ServerMessage) =>
  m.type === "status" && ["idle", "completed", "interrupted", "error"].includes((m as StatusMsg).status);

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetSessions();
  delete process.env.ALLOW_BYPASS_PERMISSIONS;
});

describe("set_mode — idle session", () => {
  it("sends mode_changed and updates currentPermissionMode when session is idle or completed", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test", permissionMode: "default" }),
    });
    const { id } = await createRes.json() as { id: string };

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    // Send a simple prompt and wait for any terminal status (test adapter echoes → completed)
    ws.send(JSON.stringify({ type: "prompt", text: "hello" }));
    await collectMessages(ws, isTerminalStatus);

    // Switch mode — now session is in terminal state (completed), which set_mode allows
    ws.send(JSON.stringify({ type: "set_mode", mode: "plan" }));
    // Wait for a mode_changed event with mode "plan" (not "default" from session start)
    const messages = await collectMessages(ws, (m) => m.type === "mode_changed" && (m as ModeMsg).mode === "plan");
    const modeMsg = messages.find((m) => m.type === "mode_changed" && (m as ModeMsg).mode === "plan") as ModeMsg;
    expect(modeMsg.mode).toBe("plan");

    // Verify currentPermissionMode is reflected in the session listing
    const listRes = await api("/api/sessions");
    const list = await listRes.json() as Array<{ id: string; permissionMode: string }>;
    const session = list.find((s) => s.id === id);
    expect(session?.permissionMode).toBe("plan");

    ws.close();
  });
});

describe("set_mode — running session guard", () => {
  it("returns error when session is in waiting_for_approval", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json() as { id: string };

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    // Trigger tool approval so session enters waiting_for_approval
    ws.send(JSON.stringify({ type: "prompt", text: "[tool-approval] block me" }));
    await collectMessages(ws, (m) => m.type === "tool_approval_request");

    // Attempt mode switch while paused at approval — guard should reject it
    ws.send(JSON.stringify({ type: "set_mode", mode: "plan" }));
    const messages = await collectMessages(ws, (m) => m.type === "error");
    const errMsg = messages.find((m) => m.type === "error") as ErrMsg;
    expect(errMsg.message).toMatch(/cannot change mode while session is running/);

    // Clean up: deny the pending approval so the session finishes
    const approvalReq = await api(`/api/sessions/${id}`);
    const sessionData = await approvalReq.json() as { pendingApproval?: { toolUseId: string } };
    if (sessionData.pendingApproval?.toolUseId) {
      ws.send(JSON.stringify({ type: "deny", toolUseId: sessionData.pendingApproval.toolUseId }));
    }

    ws.close();
  });
});

describe("set_mode — bypassPermissions guard", () => {
  it("rejects bypassPermissions when ALLOW_BYPASS_PERMISSIONS is not set", async () => {
    delete process.env.ALLOW_BYPASS_PERMISSIONS;

    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json() as { id: string };

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    // Wait for the session to reach a terminal state
    ws.send(JSON.stringify({ type: "prompt", text: "hello" }));
    await collectMessages(ws, isTerminalStatus);

    // Attempt to switch to bypassPermissions — should be rejected
    ws.send(JSON.stringify({ type: "set_mode", mode: "bypassPermissions" }));
    const messages = await collectMessages(ws, (m) => m.type === "error");
    const errMsg = messages.find((m) => m.type === "error") as ErrMsg;
    expect(errMsg.message).toMatch(/bypassPermissions/);

    ws.close();
  });

  it("allows bypassPermissions when ALLOW_BYPASS_PERMISSIONS=1", async () => {
    process.env.ALLOW_BYPASS_PERMISSIONS = "1";

    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test" }),
    });
    const { id } = await createRes.json() as { id: string };

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    ws.send(JSON.stringify({ type: "prompt", text: "hello" }));
    await collectMessages(ws, isTerminalStatus);

    ws.send(JSON.stringify({ type: "set_mode", mode: "bypassPermissions" }));
    const messages = await collectMessages(ws, (m) => m.type === "mode_changed" && (m as ModeMsg).mode === "bypassPermissions");
    const modeMsg = messages.find((m) => m.type === "mode_changed" && (m as ModeMsg).mode === "bypassPermissions") as ModeMsg;
    expect(modeMsg.mode).toBe("bypassPermissions");

    ws.close();
    delete process.env.ALLOW_BYPASS_PERMISSIONS;
  });
});

describe("clearContext approve", () => {
  it("creates a new session, interrupts the old one, and sends session_redirected with fresh: true", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test", permissionMode: "plan" }),
    });
    const { id } = await createRes.json() as { id: string };

    const ws = await connectWs(id);
    await collectMessages(ws, (m) => m.type === "replay_complete");

    // Trigger tool approval so there is a pending approval to clear-context on
    ws.send(JSON.stringify({ type: "prompt", text: "[tool-approval] plan complete" }));
    const preApproval = await collectMessages(ws, (m) => m.type === "tool_approval_request");
    const approvalReq = preApproval.find((m) => m.type === "tool_approval_request") as ServerMessage & { toolUseId: string };
    expect(approvalReq).toBeDefined();

    // Approve with clearContext: true, targetMode: "default"
    ws.send(JSON.stringify({
      type: "approve",
      toolUseId: approvalReq.toolUseId,
      clearContext: true,
      targetMode: "default",
    }));

    const postApproval = await collectMessages(ws, (m) => m.type === "session_redirected");
    const redirectMsg = postApproval.find((m) => m.type === "session_redirected") as ServerMessage & {
      newSessionId: string;
      fresh?: boolean;
    };
    expect(redirectMsg).toBeDefined();
    expect(redirectMsg.newSessionId).not.toBe(id);
    expect(redirectMsg.fresh).toBe(true);

    // Old session should be interrupted or completed
    const oldSessionStatus = await waitForStatus(id, ["interrupted", "completed", "error"]);
    expect(["interrupted", "completed", "error"]).toContain(oldSessionStatus.status);

    // New session should appear in session list with permissionMode: "default"
    const listRes = await api("/api/sessions");
    const list = await listRes.json() as Array<{ id: string; permissionMode: string }>;
    const newSession = list.find((s) => s.id === redirectMsg.newSessionId);
    expect(newSession).toBeDefined();
    expect(newSession!.permissionMode).toBe("default");

    ws.close();
  });
});

describe("listSessions — permissionMode from currentPermissionMode", () => {
  it("returns permissionMode reflecting currentPermissionMode for live sessions", async () => {
    const createRes = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider: "test", permissionMode: "acceptEdits" }),
    });
    const { id } = await createRes.json() as { id: string };

    const listRes = await api("/api/sessions");
    const list = await listRes.json() as Array<{ id: string; permissionMode: string }>;
    const found = list.find((s) => s.id === id);
    expect(found).toBeDefined();
    expect(found!.permissionMode).toBe("acceptEdits");
  });
});

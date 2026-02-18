import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
const sessions = new Map();
const MAX_SESSIONS = 50;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // run every 5 minutes
// Periodically evict finished sessions older than SESSION_TTL_MS
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
        const isFinished = s.status === "completed" || s.status === "error" || s.status === "interrupted";
        if (isFinished && s.clients.size === 0 && now - s.createdAt.getTime() > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}, CLEANUP_INTERVAL_MS);
export function listSessions() {
    return Array.from(sessions.values()).map((s) => ({
        id: s.id,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        numTurns: s.numTurns,
        totalCostUsd: s.totalCostUsd,
        hasPendingApproval: s.pendingApproval !== null,
    }));
}
export function sessionToDTO(session) {
    return {
        id: session.id,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        permissionMode: session.permissionMode,
        model: session.model,
        cwd: session.cwd,
        numTurns: session.numTurns,
        totalCostUsd: session.totalCostUsd,
        lastError: session.lastError,
        messages: session.messages,
        pendingApproval: session.pendingApproval
            ? {
                toolName: session.pendingApproval.toolName,
                toolUseId: session.pendingApproval.toolUseId,
                input: session.pendingApproval.input,
            }
            : null,
    };
}
export function getSession(id) {
    return sessions.get(id);
}
export function getSessionCount() {
    let active = 0;
    for (const s of sessions.values()) {
        if (s.status === "running" ||
            s.status === "starting" ||
            s.status === "waiting_for_approval") {
            active++;
        }
    }
    return { active, total: sessions.size };
}
export function broadcast(session, msg) {
    const data = JSON.stringify(msg);
    for (const client of session.clients) {
        try {
            if (client.readyState === 1) {
                client.send(data);
            }
        }
        catch {
            session.clients.delete(client);
        }
    }
}
export async function createSession(req) {
    if (sessions.size >= MAX_SESSIONS) {
        throw new Error(`maximum session limit reached (${MAX_SESSIONS})`);
    }
    const id = randomUUID();
    const session = {
        id,
        status: "starting",
        createdAt: new Date(),
        permissionMode: req.permissionMode ?? "default",
        model: req.model,
        cwd: req.cwd ?? "/home/claude/workspace",
        abortController: new AbortController(),
        messages: [],
        totalCostUsd: 0,
        numTurns: 0,
        lastError: null,
        pendingApproval: null,
        clients: new Set(),
    };
    sessions.set(id, session);
    // Fire and forget -- the async generator runs in the background
    runSession(session, req.prompt, req.allowedTools);
    return session;
}
async function runSession(session, prompt, allowedTools, resumeSessionId) {
    let queryHandle;
    try {
        session.status = "running";
        broadcast(session, { type: "status", status: "running" });
        queryHandle = sdkQuery({
            prompt,
            options: {
                abortController: session.abortController,
                maxTurns: 50,
                cwd: session.cwd,
                permissionMode: session.permissionMode,
                ...(session.permissionMode === "bypassPermissions"
                    ? { allowDangerouslySkipPermissions: true }
                    : {}),
                ...(session.model ? { model: session.model } : {}),
                ...(allowedTools?.length ? { allowedTools } : {}),
                ...(resumeSessionId ? { resume: resumeSessionId } : {}),
                includePartialMessages: true,
                canUseTool: session.permissionMode === "bypassPermissions"
                    ? undefined
                    : async (toolName, _input, options) => {
                        return new Promise((resolve) => {
                            session.pendingApproval = {
                                toolName,
                                toolUseId: options.toolUseID,
                                input: _input,
                                resolve,
                            };
                            session.status = "waiting_for_approval";
                            broadcast(session, {
                                type: "status",
                                status: "waiting_for_approval",
                            });
                            broadcast(session, {
                                type: "tool_approval_request",
                                toolName,
                                toolUseId: options.toolUseID,
                                input: _input,
                            });
                        });
                    },
            },
        });
        for await (const message of queryHandle) {
            session.messages.push(message);
            broadcast(session, { type: "sdk_message", message });
            // Extract cost and turn info from result messages
            if (isResultMessage(message)) {
                session.totalCostUsd = message.total_cost_usd;
                session.numTurns = message.num_turns;
                // Capture the SDK session ID for resume support (stored separately
                // so the Map key — session.id — remains the original UUID)
                if (message.session_id) {
                    session.sdkSessionId = message.session_id;
                }
            }
        }
        // Status may have been mutated externally by interruptSession()
        const currentStatus = session.status;
        if (currentStatus !== "interrupted") {
            session.status = "completed";
        }
    }
    catch (err) {
        const currentStatus = session.status;
        if (currentStatus !== "interrupted") {
            session.status = "error";
            session.lastError = String(err);
            console.error(`Session ${session.id} error:`, err);
        }
    }
    broadcast(session, {
        type: "status",
        status: session.status,
        ...(session.lastError ? { error: session.lastError } : {}),
    });
}
function isResultMessage(msg) {
    return msg.type === "result";
}
export function interruptSession(id) {
    const session = sessions.get(id);
    if (!session)
        return false;
    session.status = "interrupted";
    session.abortController.abort();
    broadcast(session, { type: "status", status: "interrupted" });
    return true;
}
export function handleApproval(session, toolUseId, allow, message) {
    if (!session.pendingApproval ||
        session.pendingApproval.toolUseId !== toolUseId)
        return false;
    const approval = session.pendingApproval;
    session.pendingApproval = null;
    session.status = "running";
    broadcast(session, { type: "status", status: "running" });
    if (allow) {
        approval.resolve({ behavior: "allow" });
    }
    else {
        approval.resolve({ behavior: "deny", message: message ?? "Denied by user" });
    }
    return true;
}
export async function sendFollowUp(session, text) {
    if (session.status === "running" || session.status === "starting") {
        return false;
    }
    session.abortController = new AbortController();
    runSession(session, text, undefined, session.sdkSessionId ?? session.id);
    return true;
}

import type { Server } from "node:http";
import type { WebSocketServer } from "ws";
import { WebSocket } from "ws";
import type { ServerMessage } from "../src/types.js";

const TEST_PASSWORD = "test-secret";

interface TestServer {
  server: Server;
  wss: WebSocketServer;
  baseUrl: string;
  port: number;
}

let activeServer: TestServer | null = null;

export async function startServer(): Promise<TestServer> {
  if (activeServer) return activeServer;

  // Set env before importing server module
  process.env.API_PASSWORD = TEST_PASSWORD;

  const { createApp } = await import("../src/index.js");
  const { clearSessions } = await import("../src/sessions.js");

  // Clear any leftover state from previous tests
  clearSessions();

  const { server, wss } = createApp();

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });

  activeServer = {
    server,
    wss,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
  };
  return activeServer;
}

export async function stopServer(): Promise<void> {
  if (!activeServer) return;
  const { server, wss } = activeServer;

  const { clearSessions } = await import("../src/sessions.js");
  clearSessions();

  // Close all WS clients
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  activeServer = null;
}

export function getBaseUrl(): string {
  if (!activeServer) throw new Error("Server not started");
  return activeServer.baseUrl;
}

export function getPassword(): string {
  return TEST_PASSWORD;
}

/** HTTP fetch helper with auth header */
export async function api(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getBaseUrl()}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TEST_PASSWORD}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/** Connect WebSocket, send auth, return connected ws */
export async function connectWs(sessionId: string): Promise<WebSocket> {
  const wsUrl = `ws://127.0.0.1:${activeServer!.port}/api/sessions/${sessionId}/stream`;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  // Authenticate
  ws.send(JSON.stringify({ type: "auth", token: TEST_PASSWORD }));

  return ws;
}

/** Collect WS messages until a predicate matches */
export async function collectMessages(
  ws: WebSocket,
  predicate: (msg: ServerMessage) => boolean,
  timeoutMs = 10_000,
): Promise<ServerMessage[]> {
  const messages: ServerMessage[] = [];

  return new Promise<ServerMessage[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`collectMessages timed out after ${timeoutMs}ms. Collected: ${JSON.stringify(messages)}`));
    }, timeoutMs);

    function onMessage(data: Buffer | string) {
      const msg = JSON.parse(typeof data === "string" ? data : data.toString()) as ServerMessage;
      messages.push(msg);
      if (predicate(msg)) {
        cleanup();
        resolve(messages);
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      ws.off("message", onMessage);
    }

    ws.on("message", onMessage);
  });
}

/** Poll REST endpoint until session reaches target status */
export async function waitForStatus(
  sessionId: string,
  targetStatus: string | string[],
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const targets = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await api(`/api/sessions/${sessionId}`);
    const body = (await res.json()) as Record<string, unknown>;
    if (targets.includes(body.status as string)) {
      return body;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitForStatus timed out waiting for ${targets.join("|")} on session ${sessionId}`);
}

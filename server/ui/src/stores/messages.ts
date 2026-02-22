import { create } from "zustand";
import { useAuthStore } from "./auth";
import type { NormalizedMessage, SlashCommand } from "../types";

type ServerMessage =
  | { type: "message"; message: NormalizedMessage }
  | { type: "tool_approval_request"; toolName: string; toolUseId: string; input: unknown }
  | { type: "status"; status: string; error?: string }
  | { type: "slash_commands"; commands: SlashCommand[] }
  | { type: "thinking_delta"; text: string }
  | { type: "replay_complete" }
  | { type: "ping" }
  | { type: "error"; message: string; error?: string };

interface PendingApproval {
  toolName: string;
  toolUseId: string;
  input: unknown;
}

interface MessagesState {
  messages: NormalizedMessage[];
  status: string;
  connected: boolean;
  pendingApproval: PendingApproval | null;
  slashCommands: SlashCommand[];
  thinkingText: string;
  thinkingStartTime: number | null;
  thinkingDurations: Record<number, number>;

  connect: (sessionId: string) => void;
  disconnect: () => void;
  sendPrompt: (text: string) => void;
  approve: (toolUseId: string, answers?: Record<string, string>) => void;
  approveAlways: (toolUseId: string) => void;
  deny: (toolUseId: string, message?: string) => void;
  interrupt: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS = 1000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let thinkingStart: number | null = null;
let messageCount = 0;
let currentSessionId: string | null = null;

function send(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  messages: [],
  status: "starting",
  connected: false,
  pendingApproval: null,
  slashCommands: [],
  thinkingText: "",
  thinkingStartTime: null,
  thinkingDurations: {},

  connect: (sessionId: string) => {
    get().disconnect();
    currentSessionId = sessionId;
    messageCount = 0;
    thinkingStart = null;
    set({
      messages: [],
      status: "starting",
      connected: false,
      pendingApproval: null,
      slashCommands: [],
      thinkingText: "",
      thinkingStartTime: null,
      thinkingDurations: {},
    });

    const doConnect = () => {
      if (currentSessionId !== sessionId) return;
      const { token } = useAuthStore.getState();
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/api/sessions/${sessionId}/stream`);

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "auth", token }));
        set({ connected: true });
        reconnectAttempts = 0;
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try { msg = JSON.parse(event.data); } catch { return; }

        switch (msg.type) {
          case "message": {
            const m = msg.message;
            const msgIdx = messageCount;
            messageCount++;
            if (m.role === "assistant" && m.parts.some((p) => p.type === "reasoning")) {
              if (thinkingStart != null) {
                const duration = Date.now() - thinkingStart;
                set((s) => ({ thinkingDurations: { ...s.thinkingDurations, [msgIdx]: duration } }));
              }
              thinkingStart = null;
              set({ thinkingText: "", thinkingStartTime: null });
            }
            set((s) => ({ messages: [...s.messages, m] }));
            break;
          }
          case "status":
            set({ status: msg.status });
            if (msg.status !== "running") {
              thinkingStart = null;
              set({ thinkingText: "", thinkingStartTime: null });
            }
            break;
          case "thinking_delta":
            set((s) => ({ thinkingText: s.thinkingText + msg.text }));
            if (thinkingStart == null) thinkingStart = Date.now();
            set({ thinkingStartTime: thinkingStart });
            break;
          case "tool_approval_request":
            set({ pendingApproval: { toolName: msg.toolName, toolUseId: msg.toolUseId, input: msg.input } });
            break;
          case "slash_commands":
            if (Array.isArray(msg.commands)) set({ slashCommands: msg.commands });
            break;
          case "error":
            console.error("Server error:", msg.message);
            break;
        }
      };

      socket.onclose = () => {
        set({ connected: false });
        if (currentSessionId === sessionId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RECONNECT_MS * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          reconnectTimer = setTimeout(doConnect, delay);
        }
      };

      socket.onerror = () => socket.close();
      ws = socket;
    };

    doConnect();
  },

  disconnect: () => {
    currentSessionId = null;
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    ws?.close();
    ws = null;
  },

  sendPrompt: (text) => send({ type: "prompt", text }),

  approve: (toolUseId, answers) => {
    send({ type: "approve", toolUseId, ...(answers ? { answers } : {}) });
    set({ pendingApproval: null });
  },

  approveAlways: (toolUseId) => {
    send({ type: "approve", toolUseId, alwaysAllow: true });
    set({ pendingApproval: null });
  },

  deny: (toolUseId, message) => {
    send({ type: "deny", toolUseId, message });
    set({ pendingApproval: null });
  },

  interrupt: () => send({ type: "interrupt" }),
}));

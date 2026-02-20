import { useState, useEffect, useRef, useCallback } from "react";
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

interface SessionHook {
  messages: NormalizedMessage[];
  slashCommands: SlashCommand[];
  status: string;
  connected: boolean;
  pendingApproval: { toolName: string; toolUseId: string; input: unknown } | null;
  thinkingText: string;
  thinkingStartTime: number | null;
  thinkingDurations: Record<number, number>;
  sendPrompt: (text: string) => void;
  approve: (toolUseId: string, answers?: Record<string, string>) => void;
  approveAlways: (toolUseId: string) => void;
  deny: (toolUseId: string, message?: string) => void;
  interrupt: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS = 1000;

export function useSession(sessionId: string | null, token: string): SessionHook {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [status, setStatus] = useState("starting");
  const [connected, setConnected] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<SessionHook["pendingApproval"]>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingDurations, setThinkingDurations] = useState<Record<number, number>>({});
  const thinkingStartRef = useRef<number | null>(null);
  const messageCountRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!sessionId || !token) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/sessions/${sessionId}/stream`);
    ws.onopen = () => {
      // Authenticate via first message (avoids token in URL / logs)
      ws.send(JSON.stringify({ type: "auth", token }));
      setConnected(true);
      reconnectAttempts.current = 0;
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.error("Malformed WebSocket message:", event.data);
        return;
      }
      switch (msg.type) {
        case "message": {
          const m = msg.message;
          const msgIdx = messageCountRef.current;
          messageCountRef.current++;
          if (m.role === "assistant" && m.parts.some((p) => p.type === "reasoning")) {
            if (thinkingStartRef.current != null) {
              const duration = Date.now() - thinkingStartRef.current;
              setThinkingDurations((prev) => ({ ...prev, [msgIdx]: duration }));
            }
            thinkingStartRef.current = null;
            setThinkingText("");
            setThinkingStartTime(null);
          }
          setMessages((prev) => [...prev, m]);
          break;
        }
        case "status":
          setStatus(msg.status);
          if (msg.status !== "running") {
            thinkingStartRef.current = null;
            setThinkingText("");
            setThinkingStartTime(null);
          }
          break;
        case "thinking_delta":
          setThinkingText((prev) => prev + msg.text);
          if (thinkingStartRef.current == null) {
            thinkingStartRef.current = Date.now();
          }
          setThinkingStartTime(thinkingStartRef.current);
          break;
        case "tool_approval_request": setPendingApproval({ toolName: msg.toolName, toolUseId: msg.toolUseId, input: msg.input }); break;
        case "slash_commands": if (Array.isArray(msg.commands)) setSlashCommands(msg.commands); break;
        case "replay_complete": break;
        case "error": console.error("Server error:", msg.message); break;
        case "ping": break;
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = BASE_RECONNECT_MS * Math.pow(2, reconnectAttempts.current);
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [sessionId, token]);

  useEffect(() => {
    setMessages([]); setStatus("starting"); setPendingApproval(null); setSlashCommands([]);
    setThinkingText(""); setThinkingStartTime(null); setThinkingDurations({});
    thinkingStartRef.current = null; messageCountRef.current = 0;
    connect();
    return () => { clearTimeout(reconnectTimer.current); wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  return {
    messages, slashCommands, status, connected, pendingApproval, thinkingText, thinkingStartTime, thinkingDurations,
    sendPrompt: (text: string) => send({ type: "prompt", text }),
    approve: (toolUseId: string, answers?: Record<string, string>) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      send({ type: "approve", toolUseId, ...(answers ? { answers } : {}) }); setPendingApproval(null);
    },
    approveAlways: (toolUseId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      send({ type: "approve", toolUseId, alwaysAllow: true }); setPendingApproval(null);
    },
    deny: (toolUseId: string, message?: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      send({ type: "deny", toolUseId, message }); setPendingApproval(null);
    },
    interrupt: () => send({ type: "interrupt" }),
  };
}

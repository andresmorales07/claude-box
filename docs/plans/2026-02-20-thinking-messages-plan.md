# Thinking Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude Code CLI-style thinking messages to the web UI — streaming thinking text with animation while active, transitioning to a collapsible "Cooked for Xs" / "Thought for Xs" badge when done.

**Architecture:** The SDK already yields `stream_event` messages with `thinking_delta` content when `includePartialMessages: true` (already enabled). We wire these through a new `onThinkingDelta` callback → WebSocket broadcast → UI accumulation. The UI shows a live `ThinkingIndicator` during streaming, then a collapsible `ThinkingBlock` for completed reasoning parts.

**Tech Stack:** TypeScript, React, CSS animations, Claude Agent SDK streaming events

---

### Task 1: Add `onThinkingDelta` to Provider Types

**Files:**
- Modify: `server/src/providers/types.ts:98-108`

**Step 1: Add the callback to ProviderSessionOptions**

In `server/src/providers/types.ts`, add `onThinkingDelta` to the `ProviderSessionOptions` interface:

```typescript
export interface ProviderSessionOptions {
  prompt: string;
  cwd: string;
  permissionMode: PermissionModeCommon;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  abortSignal: AbortSignal;
  resumeSessionId?: string;
  onToolApproval: (request: ToolApprovalRequest) => Promise<ApprovalDecision>;
  onThinkingDelta?: (text: string) => void;
}
```

**Step 2: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx tsc --noEmit`
Expected: PASS (adding an optional field is backward-compatible)

**Step 3: Commit**

```bash
git add server/src/providers/types.ts
git commit -m "feat(types): add onThinkingDelta callback to ProviderSessionOptions"
```

---

### Task 2: Add `thinking_delta` to ServerMessage Type

**Files:**
- Modify: `server/src/types.ts:66-73`

**Step 1: Add the new frame type to the ServerMessage union**

In `server/src/types.ts`, add `thinking_delta` to the `ServerMessage` union:

```typescript
export type ServerMessage =
  | { type: "message"; message: NormalizedMessage }
  | { type: "tool_approval_request"; toolName: string; toolUseId: string; input: unknown }
  | { type: "status"; status: SessionStatus; error?: string }
  | { type: "slash_commands"; commands: SlashCommand[] }
  | { type: "thinking_delta"; text: string }
  | { type: "replay_complete" }
  | { type: "ping" }
  | { type: "error"; message: string };
```

**Step 2: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): add thinking_delta to ServerMessage union"
```

---

### Task 3: Handle `stream_event` Thinking Deltas in Claude Adapter

**Files:**
- Modify: `server/src/providers/claude-adapter.ts:205-221`

**Step 1: Add stream_event handling in the `for await` loop**

In the `for await (const sdkMessage of queryHandle)` loop in `claude-adapter.ts`, add handling for `stream_event` messages **before** the existing `normalizeMessage` call:

```typescript
for await (const sdkMessage of queryHandle) {
  // Handle streaming thinking deltas (raw API events)
  if (sdkMessage.type === "stream_event") {
    const event = (sdkMessage as { type: string; event: Record<string, unknown> }).event;
    if (
      event?.type === "content_block_delta" &&
      (event.delta as Record<string, unknown>)?.type === "thinking_delta"
    ) {
      options.onThinkingDelta?.((event.delta as { thinking: string }).thinking);
    }
    continue;
  }

  // Capture result data before normalizing
  if (sdkMessage.type === "result") {
    // ... existing code unchanged ...
```

**Step 2: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add server/src/providers/claude-adapter.ts
git commit -m "feat(adapter): forward thinking_delta stream events via onThinkingDelta callback"
```

---

### Task 4: Broadcast Thinking Deltas from Session Manager

**Files:**
- Modify: `server/src/sessions.ts:135-164`

**Step 1: Pass `onThinkingDelta` callback to `adapter.run()`**

In `runSession()`, add `onThinkingDelta` to the options object passed to `adapter.run()`:

```typescript
const generator = adapter.run({
  prompt,
  cwd: session.cwd,
  permissionMode: session.permissionMode,
  model: session.model,
  allowedTools,
  maxTurns: 50,
  abortSignal: session.abortController.signal,
  resumeSessionId,
  onToolApproval: (request) =>
    new Promise((resolve) => {
      // ... existing code unchanged ...
    }),
  onThinkingDelta: (text: string) => {
    broadcast(session, { type: "thinking_delta", text });
  },
});
```

**Step 2: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add server/src/sessions.ts
git commit -m "feat(sessions): broadcast thinking_delta frames to WebSocket clients"
```

---

### Task 5: Add Thinking Delta Test to Test Adapter

**Files:**
- Modify: `server/src/providers/test-adapter.ts`
- Create: `server/tests/thinking-delta.test.ts`

**Step 1: Add `thinking` scenario to TestAdapter**

In `server/src/providers/test-adapter.ts`, add a new scenario in the switch block (before the `default` case):

```typescript
case "thinking": {
  // Simulate streaming thinking deltas
  checkAbort(abortSignal);
  options.onThinkingDelta?.("I need to ");
  await delay(50, abortSignal);
  options.onThinkingDelta?.("analyze this ");
  await delay(50, abortSignal);
  options.onThinkingDelta?.("request carefully.");

  checkAbort(abortSignal);
  // Yield the complete assistant message with reasoning + text
  yield {
    role: "assistant",
    parts: [
      { type: "reasoning", text: "I need to analyze this request carefully." },
      { type: "text", text: "Here is my response." },
    ],
    index: index++,
  };
  break;
}
```

**Step 2: Write the test**

Create `server/tests/thinking-delta.test.ts`:

```typescript
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
```

**Step 3: Run tests**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx vitest run tests/thinking-delta.test.ts`
Expected: PASS (2 tests)

**Step 4: Rebuild dist**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npm run build`

**Step 5: Commit**

```bash
git add server/src/providers/test-adapter.ts server/tests/thinking-delta.test.ts server/dist/
git commit -m "feat(test): add thinking scenario to test adapter with thinking_delta tests"
```

---

### Task 6: Add `thinking_delta` Handling to `useSession` Hook

**Files:**
- Modify: `server/ui/src/hooks/useSession.ts`

**Step 1: Add thinking state and handle thinking_delta frames**

Update the `useSession` hook:

1. Add `thinking_delta` to the `ServerMessage` type union at the top of the file.
2. Add state variables: `thinkingText`, `thinkingStartTime`.
3. Handle `thinking_delta` in the message switch.
4. Clear thinking state when a message with a reasoning part arrives or status changes.
5. Return `thinkingText`, `thinkingStartTime` from the hook.

```typescript
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
  sendPrompt: (text: string) => void;
  approve: (toolUseId: string) => void;
  deny: (toolUseId: string, message?: string) => void;
  interrupt: () => void;
}

// ... inside the hook function:

const [thinkingText, setThinkingText] = useState("");
const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);

// ... inside the switch in ws.onmessage:

case "thinking_delta":
  setThinkingText((prev) => prev + msg.text);
  setThinkingStartTime((prev) => prev ?? Date.now());
  break;

case "message": {
  const m = msg.message;
  // If this message contains a reasoning part, thinking is done — clear streaming state
  if (m.role === "assistant" && m.parts.some((p) => p.type === "reasoning")) {
    setThinkingText("");
    setThinkingStartTime(null);
  }
  setMessages((prev) => [...prev, m]);
  break;
}

// Also clear thinking state on status changes away from running:
case "status":
  setStatus(msg.status);
  if (msg.status !== "running") {
    setThinkingText("");
    setThinkingStartTime(null);
  }
  break;
```

Also update the `useEffect` that resets state on session change to include thinking state:

```typescript
useEffect(() => {
  setMessages([]); setStatus("starting"); setPendingApproval(null); setSlashCommands([]);
  setThinkingText(""); setThinkingStartTime(null);
  connect();
  return () => { clearTimeout(reconnectTimer.current); wsRef.current?.close(); };
}, [connect]);
```

And update the return:

```typescript
return {
  messages, slashCommands, status, connected, pendingApproval,
  thinkingText, thinkingStartTime,
  sendPrompt: (text: string) => send({ type: "prompt", text }),
  // ... rest unchanged
};
```

**Step 2: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server/ui && npx tsc --noEmit`
Expected: FAIL (ChatView.tsx doesn't destructure the new fields yet — that's fine, addressed in Task 9)

**Step 3: Commit**

```bash
git add server/ui/src/hooks/useSession.ts
git commit -m "feat(ui): handle thinking_delta frames in useSession hook"
```

---

### Task 7: Create `ThinkingBlock` Component (Completed Thinking)

**Files:**
- Create: `server/ui/src/components/ThinkingBlock.tsx`

**Step 1: Create the component**

Create `server/ui/src/components/ThinkingBlock.tsx`:

```tsx
import { useState } from "react";

const THINKING_LABELS = [
  "Thought for",
  "Cooked for",
  "Reasoned for",
  "Pondered for",
  "Mulled over for",
  "Considered for",
  "Reflected for",
  "Deliberated for",
];

function randomLabel(): string {
  return THINKING_LABELS[Math.floor(Math.random() * THINKING_LABELS.length)];
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

interface Props {
  text: string;
  durationMs: number | null;
}

export function ThinkingBlock({ text, durationMs }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [label] = useState(randomLabel);

  const duration = durationMs != null ? formatDuration(durationMs) : "";

  return (
    <div className="thinking-block">
      <button
        className="thinking-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-dot done" />
        <span className="thinking-label">
          {label} {duration}
        </span>
        <span className={`thinking-chevron ${expanded ? "expanded" : ""}`}>
          &#9656;
        </span>
      </button>
      {expanded && (
        <pre className="thinking-content">{text}</pre>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add server/ui/src/components/ThinkingBlock.tsx
git commit -m "feat(ui): add ThinkingBlock component for completed thinking display"
```

---

### Task 8: Create `ThinkingIndicator` Component (Active Thinking)

**Files:**
- Create: `server/ui/src/components/ThinkingIndicator.tsx`

**Step 1: Create the component**

Create `server/ui/src/components/ThinkingIndicator.tsx`:

```tsx
import { useState, useEffect } from "react";

function extractSnippet(text: string): string {
  if (!text.trim()) return "Thinking...";
  // Take the last non-empty line, truncate to 80 chars
  const lines = text.split("\n").filter((l) => l.trim());
  const last = lines[lines.length - 1] || "Thinking...";
  return last.length > 80 ? last.slice(0, 77) + "..." : last;
}

interface Props {
  thinkingText: string;
  startTime: number;
}

export function ThinkingIndicator({ thinkingText, startTime }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const snippet = extractSnippet(thinkingText);

  return (
    <div className="thinking-indicator">
      <span className="thinking-dot active" />
      <span className="thinking-text">{snippet}</span>
      <span className="thinking-elapsed">{elapsed}s</span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add server/ui/src/components/ThinkingIndicator.tsx
git commit -m "feat(ui): add ThinkingIndicator component for active thinking animation"
```

---

### Task 9: Wire Components into ChatView and MessageBubble

**Files:**
- Modify: `server/ui/src/components/ChatView.tsx`
- Modify: `server/ui/src/components/MessageBubble.tsx`

**Step 1: Update ChatView to pass thinking state and render ThinkingIndicator**

In `server/ui/src/components/ChatView.tsx`:

1. Destructure `thinkingText` and `thinkingStartTime` from `useSession`.
2. Compute `thinkingDurationMs` — capture the duration when thinking completes (when a reasoning part arrives and `thinkingStartTime` was set).
3. Render `<ThinkingIndicator>` in the messages area when thinking is active.
4. Pass `thinkingDurationMs` and `isLastMessage` to `<MessageBubble>`.

```tsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolApproval } from "./ToolApproval";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { SlashCommandDropdown, getFilteredCommands } from "./SlashCommandDropdown";
import { useSession } from "../hooks/useSession";
import type { SlashCommand } from "../types";

interface Props { sessionId: string; token: string; }

export function ChatView({ sessionId, token }: Props) {
  const { messages, slashCommands, status, connected, pendingApproval, thinkingText, thinkingStartTime, sendPrompt, approve, deny, interrupt } = useSession(sessionId, token);
  const [input, setInput] = useState("");
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track the last thinking duration for completed thinking blocks
  const thinkingDurationRef = useRef<number | null>(null);
  const prevThinkingStartRef = useRef<number | null>(null);

  // When thinkingStartTime clears (thinking complete), freeze the duration
  useEffect(() => {
    if (prevThinkingStartRef.current != null && thinkingStartTime == null) {
      thinkingDurationRef.current = Date.now() - prevThinkingStartRef.current;
    }
    prevThinkingStartRef.current = thinkingStartTime;
  }, [thinkingStartTime]);

  // ... existing code (useEffect for scroll, filtered, dropdownVisible, etc.) unchanged ...

  const isThinkingActive = thinkingText.length > 0 && thinkingStartTime != null;

  return (
    <div className="chat-view">
      {/* ... existing chat-header unchanged ... */}
      <div className="messages">
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            thinkingDurationMs={thinkingDurationRef.current}
          />
        ))}
        {isThinkingActive && (
          <ThinkingIndicator thinkingText={thinkingText} startTime={thinkingStartTime!} />
        )}
        <div ref={messagesEndRef} />
      </div>
      {/* ... rest unchanged ... */}
    </div>
  );
}
```

**Step 2: Update MessageBubble to use ThinkingBlock for reasoning parts**

In `server/ui/src/components/MessageBubble.tsx`:

```tsx
import type { NormalizedMessage, MessagePart } from "../types";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  message: NormalizedMessage;
  thinkingDurationMs: number | null;
}

function renderPart(part: MessagePart, i: number, thinkingDurationMs: number | null) {
  switch (part.type) {
    case "text":
      return <pre key={i}>{part.text}</pre>;
    case "tool_use":
      return (
        <div key={i} className="message tool">
          <strong>{part.toolName}</strong>
          <pre>{JSON.stringify(part.input, null, 2)}</pre>
        </div>
      );
    case "tool_result":
      return (
        <div key={i} className="message tool">
          <pre>{part.output}</pre>
        </div>
      );
    case "reasoning":
      return <ThinkingBlock key={i} text={part.text} durationMs={thinkingDurationMs} />;
    case "error":
      return <div key={i} className="message error">{part.message}</div>;
    default:
      return null;
  }
}

export function MessageBubble({ message, thinkingDurationMs }: Props) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!text) return null;
    return <div className="message user">{text}</div>;
  }

  if (message.role === "assistant") {
    return <>{message.parts.map((part, i) => renderPart(part, i, thinkingDurationMs))}</>;
  }

  if (message.role === "system" && message.event.type === "session_result") {
    return (
      <div className="message assistant">
        <em>Session completed. Cost: ${message.event.totalCostUsd.toFixed(4)}, Turns: {message.event.numTurns}</em>
      </div>
    );
  }

  return null;
}
```

**Step 3: Run type check**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server/ui && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add server/ui/src/components/ChatView.tsx server/ui/src/components/MessageBubble.tsx
git commit -m "feat(ui): wire ThinkingBlock and ThinkingIndicator into ChatView and MessageBubble"
```

---

### Task 10: Add CSS Styles for Thinking Components

**Files:**
- Modify: `server/ui/src/styles.css`

**Step 1: Add thinking styles**

Add the following CSS after the `.message.tool strong` block (around line 335) in `server/ui/src/styles.css`:

```css
/* === Thinking Block (completed) === */
.thinking-block {
  align-self: flex-start;
  max-width: 90%;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 0.375rem 0;
  transition: color 0.2s ease;
}

.thinking-header:hover {
  color: var(--text);
}

.thinking-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.thinking-dot.done {
  background: var(--text-muted);
}

.thinking-dot.active {
  background: var(--accent);
  animation: thinking-pulse 1.5s ease-in-out infinite;
}

.thinking-label {
  white-space: nowrap;
}

.thinking-chevron {
  font-size: 0.625rem;
  transition: transform 0.2s ease;
  margin-left: auto;
}

.thinking-chevron.expanded {
  transform: rotate(90deg);
}

.thinking-content {
  white-space: pre-wrap;
  font-family: var(--mono);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-muted);
  border-left: 2px solid var(--border);
  padding: 0.5rem 0 0.5rem 0.75rem;
  margin: 0.25rem 0 0.25rem 3px;
  max-height: 300px;
  overflow-y: auto;
}

/* === Thinking Indicator (active/streaming) === */
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  font-size: 0.8125rem;
  align-self: flex-start;
}

.thinking-indicator .thinking-text {
  color: var(--accent);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 500px;
}

.thinking-indicator .thinking-elapsed {
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
  margin-left: auto;
}

@keyframes thinking-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}
```

**Step 2: Remove old `.reasoning` style (if any)**

There is no existing `.reasoning` CSS rule in styles.css (the class existed in HTML but was unstyled). No removal needed.

**Step 3: Commit**

```bash
git add server/ui/src/styles.css
git commit -m "feat(ui): add thinking block and indicator CSS with pulse animation"
```

---

### Task 11: Build, Run Full Test Suite, Verify

**Files:**
- Rebuild: `server/dist/`

**Step 1: Rebuild server dist**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npm run build`
Expected: Build succeeds without errors

**Step 2: Rebuild UI**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server/ui && npm run build`
Expected: Build succeeds without errors

**Step 3: Run all vitest tests**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx vitest run`
Expected: All tests pass, including the new `thinking-delta.test.ts`

**Step 4: Run type checks**

Run: `cd /home/hatchpod/workspace/repos/hatchpod/server && npx tsc --noEmit && cd ui && npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit dist**

```bash
git add server/dist/ server/public/
git commit -m "build: rebuild dist and public for thinking messages feature"
```

---

### Task 12: Update Desktop Layout Media Query

**Files:**
- Modify: `server/ui/src/styles.css`

**Step 1: Ensure thinking block respects desktop max-width**

The existing `.message` max-width rule at `@media (min-width: 768px)` sets `max-width: 70%`. The `.thinking-block` needs the same treatment. Add inside the existing media query:

```css
@media (min-width: 768px) {
  /* ... existing rules ... */
  .thinking-block {
    max-width: 70%;
  }
}
```

**Step 2: Commit**

```bash
git add server/ui/src/styles.css
git commit -m "fix(ui): thinking block respects desktop max-width"
```

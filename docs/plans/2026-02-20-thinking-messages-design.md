# Thinking Messages Design

**Date:** 2026-02-20
**Status:** Draft

## Goal

Add Claude Code CLI-style thinking messages to the Hatchpod web UI. While the model is reasoning, show an animated indicator with dynamic text from the streaming thinking content. When thinking completes, transition to a collapsible "Cooked for Xs" / "Thought for Xs" badge (randomly chosen) that expands to reveal the full thinking text.

## Current State

The pipeline for thinking blocks already exists end-to-end:

- `ReasoningPart { type: "reasoning", text: string }` is defined in both server and UI types
- The Claude adapter maps SDK `"thinking"` content blocks to `ReasoningPart`
- `MessageBubble.tsx` renders reasoning parts as `<div class="reasoning"><em>{text}</em></div>`

However, the SDK also yields `stream_event` messages with `thinking_delta` content when `includePartialMessages: true` (already enabled). The adapter currently ignores these — it only processes complete `assistant`, `user`, and `result` messages. This means thinking appears as a single static block after the model finishes, with no streaming or animation.

## Design

### Data Flow

```
SDK stream_event (thinking_delta)
  -> adapter calls onThinkingDelta(text)
    -> session manager broadcasts { type: "thinking_delta", text }
      -> useSession accumulates thinkingText state
        -> ChatView renders <ThinkingIndicator> with streaming text

SDK assistant message (complete, with ThinkingBlock)
  -> adapter yields NormalizedMessage with ReasoningPart
    -> broadcast as { type: "message", ... }
      -> useSession clears thinkingText, appends message
        -> MessageBubble renders <ThinkingBlock> in "done" state
```

### Server Changes

#### 1. Provider types (`server/src/providers/types.ts`)

Add optional callback to `ProviderSessionOptions`:

```typescript
onThinkingDelta?: (text: string) => void;
```

#### 2. Claude adapter (`server/src/providers/claude-adapter.ts`)

Handle `stream_event` messages in the `for await` loop:

```typescript
if (sdkMessage.type === "stream_event") {
  const event = (sdkMessage as any).event;
  if (event?.type === "content_block_delta" && event?.delta?.type === "thinking_delta") {
    options.onThinkingDelta?.(event.delta.thinking);
  }
  continue; // don't normalize stream events as messages
}
```

#### 3. Session manager (`server/src/sessions.ts`)

Pass `onThinkingDelta` callback when calling `adapter.run()`:

```typescript
onThinkingDelta: (text: string) => {
  broadcast(session, { type: "thinking_delta", text });
}
```

#### 4. WebSocket types

Add `thinking_delta` to `ServerMessage` union (documentation only — broadcast already sends arbitrary JSON).

### UI Changes

#### 5. `useSession.ts` hook

New state: `thinkingText: string` — accumulates `thinking_delta` frames.

```typescript
case "thinking_delta":
  setThinkingText(prev => prev + msg.text);
  break;
```

Reset `thinkingText` to `""` when a `message` frame arrives containing a `ReasoningPart`, or when status changes away from `"running"`.

Track `thinkingStartTime: number | null` — set to `Date.now()` on first `thinking_delta`, cleared alongside `thinkingText`.

Return `thinkingText`, `thinkingStartTime` from the hook.

#### 6. New component: `ThinkingIndicator.tsx`

Rendered in `ChatView` when `thinkingText` is non-empty and session is running. Shows:

- Pulsing dot animation (CSS `@keyframes`)
- Dynamic text: last meaningful line/sentence extracted from `thinkingText`
- Live elapsed timer updating every second

This is the "while thinking" state — shown below the message list, above the input.

#### 7. New component: `ThinkingBlock.tsx`

Rendered by `MessageBubble` for `ReasoningPart` in complete assistant messages. Two states:

**Collapsed (default):**
```
[dot] Cooked for 5s                              [chevron]
```

**Expanded:**
```
[dot] Cooked for 5s                              [chevron]
| I need to analyze the user's request...
| The error is likely in the authentication
| handler because...
```

Completion message is randomly chosen from a pool on mount (see below).

#### 8. `MessageBubble.tsx`

Replace the inline reasoning render:
```tsx
// Before
case "reasoning":
  return <div key={i} className="reasoning"><em>{part.text}</em></div>;

// After
case "reasoning":
  return <ThinkingBlock key={i} text={part.text} durationMs={durationMs} />;
```

`durationMs` is computed from the `thinkingStartTime` that was captured when the first delta arrived. The hook stores the final duration when thinking completes and passes it down.

#### 9. `ChatView.tsx`

- Pass `thinkingText`, `thinkingStartTime`, and `status` for the `ThinkingIndicator`
- Pass `thinkingDuration` to `MessageBubble` for completed thinking blocks

#### 10. `styles.css`

New styles:

```css
/* Thinking indicator (active/streaming) */
.thinking-indicator { ... }
.thinking-indicator .thinking-dot { animation: thinking-pulse 1.5s ease-in-out infinite; }
.thinking-indicator .thinking-text { color: var(--accent); transition: color 0.3s ease; }

/* Thinking block (completed, collapsible) */
.thinking-block { ... }
.thinking-block .thinking-header { cursor: pointer; color: var(--text-muted); }
.thinking-block .thinking-content { font-family: var(--mono); color: var(--text-muted); border-left: 2px solid var(--border); }

@keyframes thinking-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
```

### Completion Message Pool

Randomly chosen on component mount via `useState(() => randomLabel())`:

```typescript
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
```

### Duration Tracking

Purely client-side:

1. `useSession` records `thinkingStartTime = Date.now()` on first `thinking_delta` frame
2. `ThinkingIndicator` shows live elapsed via `setInterval(1s)`
3. When thinking completes (full `ReasoningPart` message arrives), `useSession` computes `thinkingDuration = Date.now() - thinkingStartTime` and stores it
4. `ThinkingBlock` receives the frozen duration and displays it

### Dynamic Text Extraction

The `ThinkingIndicator` extracts a display snippet from `thinkingText`:

1. Split accumulated text by newlines
2. Take the last non-empty line
3. Truncate to ~80 characters with ellipsis if needed
4. If text is empty or whitespace-only, show "Thinking..."

This gives the rolling "status update" effect as the model's thinking evolves.

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `server/src/providers/types.ts` | Edit | Add `onThinkingDelta` to options interface |
| `server/src/providers/claude-adapter.ts` | Edit | Handle `stream_event` thinking deltas |
| `server/src/sessions.ts` | Edit | Pass `onThinkingDelta` callback, broadcast frame |
| `server/ui/src/hooks/useSession.ts` | Edit | Accumulate thinking deltas, track timing |
| `server/ui/src/components/ThinkingIndicator.tsx` | New | Animated streaming thinking display |
| `server/ui/src/components/ThinkingBlock.tsx` | New | Collapsible completed thinking block |
| `server/ui/src/components/MessageBubble.tsx` | Edit | Delegate reasoning to ThinkingBlock |
| `server/ui/src/components/ChatView.tsx` | Edit | Wire up ThinkingIndicator + pass props |
| `server/ui/src/styles.css` | Edit | Thinking styles + animations |
| `server/dist/` | Rebuild | Tracked in git |

## Not in Scope

- Server-side duration tracking (client-side is accurate enough)
- Thinking block deduplication for partial messages (existing behavior, separate concern)
- Configurable thinking visibility toggle (future enhancement)
- Thinking content in session replay (reasoning parts already replay correctly)

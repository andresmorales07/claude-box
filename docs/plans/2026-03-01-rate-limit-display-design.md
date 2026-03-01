# Rate Limit Usage Display

## Summary

Surface SDK rate limit events (`SDKRateLimitEvent`) in the Hatchpod web UI. Show detailed usage on the Settings page with progress bars per limit type. Show transient toast notifications during active sessions when warning thresholds are crossed.

## Data Source

The Claude Agent SDK streams `rate_limit_event` messages as a side-effect of API calls. These contain utilization percentages, reset times, and limit types parsed from Anthropic API response headers (`anthropic-ratelimit-unified-*`). There is no standalone rate limit query endpoint — data is only available after an API call occurs during a session.

## Data Model

Defined as a Zod schema in `schemas/providers.ts` (single source of truth):

```typescript
export type RateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;           // Unix timestamp (seconds)
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage";
  utilization?: number;        // 0.0–1.0
  overageStatus?: "allowed" | "allowed_warning" | "rejected";
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
};
```

## Server-Side Pipeline

### A. Claude Adapter (`claude-adapter.ts`)

Handle `rate_limit_event` in the message loop (alongside existing `tool_progress`, `stream_event` handlers). Call `options.onRateLimit?.(info)` callback. Pattern matches the existing `onCompacting`, `onContextUsage` callbacks.

### B. Provider Types (`providers/types.ts`)

Add `onRateLimit?: (info: RateLimitInfo) => void` to `ProviderSessionOptions`.

### C. Session Manager (`sessions.ts`)

Wire callback: `onRateLimit: (info) => { updateCachedRateLimits(info); watcher.pushEvent(sessionId, { type: "rate_limit", ...info }); }`.

### D. Global Cache (`rate-limits.ts`)

Module-level `let cachedRateLimitInfo: { info: RateLimitInfo; lastUpdated: string } | null`. Updated whenever any session's `onRateLimit` fires. Rate limits are account-level (not per-session), so a single global cache is correct. Exported via `getCachedRateLimits()` and `updateCachedRateLimits()`.

### E. Session Watcher (`session-watcher.ts`)

No per-session buffering needed. `pushEvent()` broadcasts rate limit events to connected WS clients as-is (same as `tool_progress` — ephemeral, not buffered).

### F. REST Endpoint (`routes.ts`)

`GET /api/rate-limits` (authenticated). Returns `{ info: RateLimitInfo, lastUpdated: string }` or `204 No Content` if no data observed yet. Registered in `schemas/registry.ts` for OpenAPI docs.

### G. Server Message Type (`types.ts`)

Add to `ServerMessage` union:
```typescript
| { type: "rate_limit"; status: string; rateLimitType?: string; utilization?: number; resetsAt?: number; overageStatus?: string; overageResetsAt?: number; overageDisabledReason?: string; isUsingOverage?: boolean; surpassedThreshold?: number }
```

## UI Pipeline

### A. Message Store (`stores/messages.ts`)

Add `rateLimitInfo: RateLimitInfo | null` to `MessagesState`. Handle `type: "rate_limit"` in the WS message switch — update store, fire toast on `allowed_warning` or `rejected`.

### B. Toast System

Install `sonner` in `server/ui/`. Add `<Toaster />` to `App.tsx`.

Toast messages (mirroring CLI format):
- Warning: "You've used 82% of your session limit · resets in 1h 45m"
- Rejected: "Session limit reached · resets in 2h 15m"
- Overage: "Now using extra usage"

Deduplication: only fire if `rateLimitType` + `status` combo differs from last toast.

### C. Settings Page

New "Usage" card between "Claude" and "Terminal" sections.

Progress bars per active limit type with human-readable labels:
- `five_hour` → "Session limit"
- `seven_day` → "Weekly limit"
- `seven_day_opus` → "Opus limit"
- `seven_day_sonnet` → "Sonnet limit"
- `overage` → "Extra usage"

Color coding: green (< 75%), amber (75–90%), red (>= 90%).

Each bar shows percentage text and "resets in X" relative time below.

If `isUsingOverage: true`, show "Using extra usage" indicator.

Fetches from `GET /api/rate-limits` on mount. Empty state: "No usage data available — rate limits are reported after your first session."

Shows "Last updated" relative timestamp for data freshness.

`resetsAt` countdown computed client-side from the Unix timestamp, so it stays accurate even with stale server data.

## Testing

### Unit tests (vitest)

- `claude-adapter-rate-limit.test.ts` — Mock SDK yielding `rate_limit_event`, verify `onRateLimit` callback fires with correct `RateLimitInfo`
- `session-watcher-rate-limit.test.ts` — Verify `pushEvent()` broadcasts rate limit events to connected WS clients
- `rate-limits.test.ts` — Verify global cache update + `GET /api/rate-limits` returns cached data / 204 when empty

### E2e (Playwright, `session-delivery.spec.ts`)

- Test provider emits rate limit event → verify WS client receives `{ type: "rate_limit", ... }`
- Requires adding rate limit event support to `TestAdapter`

## Out of Scope

- Polling/auto-refresh on Settings page
- Rate limit data in session history/JSONL
- Per-model limit breakdown in toast (toast shows only the triggering limit)
- Overage management UI (purchase/manage extra usage)

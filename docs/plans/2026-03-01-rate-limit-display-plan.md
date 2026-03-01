# Rate Limit Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface SDK rate limit events in the Hatchpod web UI — Settings page with progress bars, toast notifications during active sessions.

**Architecture:** SDK streams `rate_limit_event` → `claude-adapter.ts` calls `onRateLimit` callback → `sessions.ts` updates a global cache + broadcasts via `pushEvent()` → WS delivers to UI → toast on warnings, Settings page shows progress bars. A REST endpoint `GET /api/rate-limits` serves the cached data for the Settings page.

**Tech Stack:** Zod (schema), vitest (tests), sonner (toast), Tailwind CSS v4 (styling), zustand (state)

---

### Task 1: Zod Schema + Type Exports

**Files:**
- Modify: `server/src/schemas/providers.ts:255-258` (add schema + type export after existing types)
- Modify: `server/src/schemas/index.ts:28,54` (add to barrel exports)
- Modify: `server/src/providers/types.ts:25,37` (re-export from schemas)

**Step 1: Add RateLimitInfoSchema to providers.ts**

Add after `CompactBoundaryEvent` type export (line 255) in `server/src/schemas/providers.ts`:

```typescript
// ── Rate limit info (account-level, from SDK rate_limit_event) ──

export const RateLimitStatusSchema = z
  .enum(["allowed", "allowed_warning", "rejected"])
  .openapi("RateLimitStatus");

export const RateLimitTypeSchema = z
  .enum(["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"])
  .openapi("RateLimitType");

export const RateLimitInfoSchema = z
  .object({
    status: RateLimitStatusSchema,
    resetsAt: z.number().optional().openapi({ description: "Unix timestamp (seconds) when the limit resets" }),
    rateLimitType: RateLimitTypeSchema.optional(),
    utilization: z.number().min(0).max(1).optional().openapi({ description: "Usage fraction 0.0–1.0" }),
    overageStatus: RateLimitStatusSchema.optional(),
    overageResetsAt: z.number().optional(),
    overageDisabledReason: z.string().optional(),
    isUsingOverage: z.boolean().optional(),
    surpassedThreshold: z.number().optional(),
  })
  .openapi("RateLimitInfo");

export const CachedRateLimitResponseSchema = z
  .object({
    info: RateLimitInfoSchema,
    lastUpdated: z.string().openapi({ description: "ISO 8601 timestamp when the cache was last updated" }),
  })
  .openapi("CachedRateLimitResponse");

export type RateLimitInfo = z.infer<typeof RateLimitInfoSchema>;
export type CachedRateLimitResponse = z.infer<typeof CachedRateLimitResponseSchema>;
```

**Step 2: Add to barrel exports in index.ts**

In `server/src/schemas/index.ts`, add `RateLimitInfoSchema` and `CachedRateLimitResponseSchema` to the schema exports block (after line 27 `ModelChangedEventSchema`), and `RateLimitInfo` and `CachedRateLimitResponse` to the type exports block (after line 53 `ModelChangedEvent`).

**Step 3: Re-export from providers/types.ts**

In `server/src/providers/types.ts`, add `RateLimitInfo` to both the `export type` block (line 3-25) and the `import type` block (line 29-37).

**Step 4: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add server/src/schemas/providers.ts server/src/schemas/index.ts server/src/providers/types.ts
git commit -m "feat: add RateLimitInfo Zod schema and type exports"
```

---

### Task 2: Global Rate Limit Cache

**Files:**
- Create: `server/src/rate-limits.ts`
- Test: `server/tests/rate-limits.test.ts`

**Step 1: Write the test**

Create `server/tests/rate-limits.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { getCachedRateLimits, updateCachedRateLimits, clearCachedRateLimits } from "../src/rate-limits.js";

describe("rate-limits cache", () => {
  beforeEach(() => {
    clearCachedRateLimits();
  });

  it("returns null when no data cached", () => {
    expect(getCachedRateLimits()).toBeNull();
  });

  it("stores and retrieves rate limit info", () => {
    const info = { status: "allowed" as const, rateLimitType: "five_hour" as const, utilization: 0.42 };
    updateCachedRateLimits(info);
    const cached = getCachedRateLimits();
    expect(cached).not.toBeNull();
    expect(cached!.info).toEqual(info);
    expect(cached!.lastUpdated).toBeTruthy();
  });

  it("overwrites previous data on update", () => {
    updateCachedRateLimits({ status: "allowed" as const, utilization: 0.5 });
    updateCachedRateLimits({ status: "allowed_warning" as const, utilization: 0.85 });
    const cached = getCachedRateLimits();
    expect(cached!.info.status).toBe("allowed_warning");
    expect(cached!.info.utilization).toBe(0.85);
  });

  it("clears cache", () => {
    updateCachedRateLimits({ status: "allowed" as const });
    clearCachedRateLimits();
    expect(getCachedRateLimits()).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/rate-limits.test.ts`
Expected: FAIL (module not found)

**Step 3: Write implementation**

Create `server/src/rate-limits.ts`:

```typescript
import type { RateLimitInfo, CachedRateLimitResponse } from "./schemas/index.js";

let cached: CachedRateLimitResponse | null = null;

export function getCachedRateLimits(): CachedRateLimitResponse | null {
  return cached;
}

export function updateCachedRateLimits(info: RateLimitInfo): void {
  cached = { info, lastUpdated: new Date().toISOString() };
}

export function clearCachedRateLimits(): void {
  cached = null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/rate-limits.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/rate-limits.ts server/tests/rate-limits.test.ts
git commit -m "feat: add global rate limit cache module"
```

---

### Task 3: Provider Callback + Claude Adapter

**Files:**
- Modify: `server/src/providers/types.ts:74` (add onRateLimit to ProviderSessionOptions)
- Modify: `server/src/providers/claude-adapter.ts:430-443` (add rate_limit_event handler)
- Test: `server/tests/claude-adapter-rate-limit.test.ts`

**Step 1: Add onRateLimit to ProviderSessionOptions**

In `server/src/providers/types.ts`, add after line 74 (`onContextUsage`):

```typescript
  onRateLimit?: (info: RateLimitInfo) => void;
```

Also add `RateLimitInfo` to the import block (line 29-37).

**Step 2: Write the test**

Create `server/tests/claude-adapter-rate-limit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderSessionOptions, RateLimitInfo } from "../src/providers/types.js";

const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { ClaudeAdapter } = await import("../src/providers/claude-adapter.js");

function createMockHandle(messages: Record<string, unknown>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) yield msg;
    },
    supportedCommands: () => Promise.resolve([]),
  };
}

function makeOptions(overrides: Partial<ProviderSessionOptions> = {}): ProviderSessionOptions {
  return {
    prompt: "test",
    cwd: "/tmp",
    permissionMode: "default",
    abortSignal: new AbortController().signal,
    onToolApproval: () => Promise.resolve({ allow: true as const }),
    ...overrides,
  };
}

describe("ClaudeAdapter rate_limit_event handling", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls onRateLimit when rate_limit_event is received", async () => {
    const rateLimits: RateLimitInfo[] = [];

    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "five_hour",
          utilization: 0.82,
          resetsAt: 1735689600,
        },
      },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }], usage: {} },
        parent_tool_use_id: null,
        uuid: "test-uuid",
        session_id: "test-session",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        num_turns: 1,
        result: "done",
        session_id: "test-session",
        modelUsage: {},
        permission_denials: [],
        uuid: "result-uuid",
      },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions({
      onRateLimit: (info) => rateLimits.push(info),
    }));

    // Consume all yielded messages
    const messages = [];
    let result;
    while (true) {
      const next = await gen.next();
      if (next.done) { result = next.value; break; }
      messages.push(next.value);
    }

    expect(rateLimits).toHaveLength(1);
    expect(rateLimits[0]).toEqual({
      status: "allowed_warning",
      rateLimitType: "five_hour",
      utilization: 0.82,
      resetsAt: 1735689600,
    });
  });

  it("does not crash when onRateLimit is not provided", async () => {
    mockQuery.mockReturnValue(createMockHandle([
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed" },
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0,
        num_turns: 0,
        result: "",
        session_id: "s",
        modelUsage: {},
        permission_denials: [],
        uuid: "u",
      },
    ]));

    const adapter = new ClaudeAdapter();
    const gen = adapter.run(makeOptions());
    while (true) {
      const next = await gen.next();
      if (next.done) break;
    }
    // No error thrown = pass
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/claude-adapter-rate-limit.test.ts`
Expected: FAIL (onRateLimit never called — rate_limit_event not handled)

**Step 4: Add handler in claude-adapter.ts**

In `server/src/providers/claude-adapter.ts`, add a handler block after the `tool_use_summary` handler (after line 455, before the `// Capture result data before normalizing` comment). Pattern matches the existing `tool_progress` handler:

```typescript
        // Handle rate limit events (ephemeral — forwarded to UI via callback, not stored)
        if (sdkMessage.type === "rate_limit_event") {
          const rl = sdkMessage as { type: string; rate_limit_info: Record<string, unknown> };
          if (rl.rate_limit_info) {
            try {
              options.onRateLimit?.({
                status: rl.rate_limit_info.status as "allowed" | "allowed_warning" | "rejected",
                ...(rl.rate_limit_info.resetsAt !== undefined ? { resetsAt: rl.rate_limit_info.resetsAt as number } : {}),
                ...(rl.rate_limit_info.rateLimitType !== undefined ? { rateLimitType: rl.rate_limit_info.rateLimitType as "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage" } : {}),
                ...(rl.rate_limit_info.utilization !== undefined ? { utilization: rl.rate_limit_info.utilization as number } : {}),
                ...(rl.rate_limit_info.overageStatus !== undefined ? { overageStatus: rl.rate_limit_info.overageStatus as "allowed" | "allowed_warning" | "rejected" } : {}),
                ...(rl.rate_limit_info.overageResetsAt !== undefined ? { overageResetsAt: rl.rate_limit_info.overageResetsAt as number } : {}),
                ...(rl.rate_limit_info.overageDisabledReason !== undefined ? { overageDisabledReason: rl.rate_limit_info.overageDisabledReason as string } : {}),
                ...(rl.rate_limit_info.isUsingOverage !== undefined ? { isUsingOverage: rl.rate_limit_info.isUsingOverage as boolean } : {}),
                ...(rl.rate_limit_info.surpassedThreshold !== undefined ? { surpassedThreshold: rl.rate_limit_info.surpassedThreshold as number } : {}),
              });
            } catch (err) {
              console.error("claude-adapter: onRateLimit callback failed:", err);
            }
          }
          continue;
        }
```

**Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/claude-adapter-rate-limit.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/providers/types.ts server/src/providers/claude-adapter.ts server/tests/claude-adapter-rate-limit.test.ts
git commit -m "feat: handle rate_limit_event in claude adapter"
```

---

### Task 4: Wire Callback in sessions.ts + ServerMessage Type

**Files:**
- Modify: `server/src/sessions.ts:316-324` (add onRateLimit callback after onContextUsage)
- Modify: `server/src/types.ts:68` (add rate_limit to ServerMessage union)

**Step 1: Add import for rate-limits cache**

At the top of `server/src/sessions.ts`, add:

```typescript
import { updateCachedRateLimits } from "./rate-limits.js";
```

**Step 2: Add onRateLimit callback**

In `server/src/sessions.ts`, add after the `onContextUsage` callback (after line 324):

```typescript
      onRateLimit: (info) => {
        updateCachedRateLimits(info);
        watcher!.pushEvent(session.sessionId, { type: "rate_limit", ...info });
      },
```

**Step 3: Add rate_limit to ServerMessage union**

In `server/src/types.ts`, add to the `ServerMessage` union (before the `| { type: "ping" }` line 68):

```typescript
  | { type: "rate_limit"; status: string; rateLimitType?: string; utilization?: number; resetsAt?: number; overageStatus?: string; overageResetsAt?: number; overageDisabledReason?: string; isUsingOverage?: boolean; surpassedThreshold?: number }
```

**Step 4: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/sessions.ts server/src/types.ts
git commit -m "feat: wire rate limit callback in session manager"
```

---

### Task 5: REST Endpoint + OpenAPI Registration

**Files:**
- Modify: `server/src/routes.ts:386` (add GET /api/rate-limits before GET /api/settings)
- Modify: `server/src/schemas/registry.ts:365` (register OpenAPI path)

**Step 1: Add route handler**

In `server/src/routes.ts`, add import at top:

```typescript
import { getCachedRateLimits } from "./rate-limits.js";
```

Add the route handler before the `GET /api/settings` block (before line 386):

```typescript
  // GET /api/rate-limits — cached subscription rate limit info
  if (pathname === "/api/rate-limits" && method === "GET") {
    const cached = getCachedRateLimits();
    if (!cached) {
      res.writeHead(204);
      res.end();
    } else {
      json(res, 200, cached);
    }
    return;
  }
```

**Step 2: Register in OpenAPI**

In `server/src/schemas/registry.ts`, add import:

```typescript
import { CachedRateLimitResponseSchema } from "./providers.js";
```

Add path registration before the `GET /api/settings` block (before line 366):

```typescript
registry.registerPath({
  method: "get",
  path: "/api/rate-limits",
  summary: "Subscription rate limits",
  description:
    "Returns cached subscription rate limit information (session limit, weekly limit, " +
    "per-model limits). Data is populated after the first API call in any session. " +
    "Returns 204 if no rate limit data has been observed yet.",
  tags: ["Config"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "Cached rate limit info",
      content: { "application/json": { schema: CachedRateLimitResponseSchema } },
    },
    204: {
      description: "No rate limit data available yet",
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
```

**Step 3: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/routes.ts server/src/schemas/registry.ts
git commit -m "feat: add GET /api/rate-limits endpoint with OpenAPI docs"
```

---

### Task 6: Test Adapter Rate Limit Scenario

**Files:**
- Modify: `server/src/providers/test-adapter.ts:463-474` (add `rate-limit` scenario before `default`)

**Step 1: Add rate-limit scenario**

In `server/src/providers/test-adapter.ts`, add a new case before the `default:` case (before line 465):

```typescript
      case "rate-limit": {
        // Simulate a rate limit event followed by a response
        checkAbort(abortSignal);
        try {
          options.onRateLimit?.({
            status: "allowed_warning",
            rateLimitType: "five_hour",
            utilization: 0.82,
            resetsAt: Math.floor(Date.now() / 1000) + 3600,
          });
        } catch (err) {
          console.error("test-adapter: onRateLimit callback failed:", err);
        }

        yield {
          role: "assistant",
          parts: [{ type: "text", text: `Echo: ${cleanPrompt}` }],
          index: index++,
        };
        break;
      }
```

Also add `RateLimitInfo` to the import from types if not already present (it's used implicitly through the callback type but may need explicit import for the literal object).

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add server/src/providers/test-adapter.ts
git commit -m "feat: add rate-limit scenario to test adapter"
```

---

### Task 7: Install Sonner + Toast Setup

**Files:**
- Modify: `server/ui/package.json` (add sonner dependency)
- Modify: `server/ui/src/App.tsx:91` (add `<Toaster />` component)

**Step 1: Install sonner**

Run: `cd server/ui && npm install sonner`

**Step 2: Add Toaster to App.tsx**

In `server/ui/src/App.tsx`, add import:

```typescript
import { Toaster } from "sonner";
```

Add `<Toaster />` inside the `<TooltipProvider>` wrapper, after the `<Routes>` block (before line 91, closing `</TooltipProvider>`):

```tsx
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          className: "bg-card text-card-foreground border-border",
        }}
      />
```

**Step 3: Run type check**

Run: `cd server/ui && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add server/ui/package.json server/ui/package-lock.json server/ui/src/App.tsx
git commit -m "feat: install sonner and add Toaster to App"
```

---

### Task 8: UI Store — Handle Rate Limit WS Events + Toast

**Files:**
- Modify: `server/ui/src/stores/messages.ts:96,467` (add state field + WS case handler)

**Step 1: Add RateLimitInfo type to UI**

The UI doesn't import from the server schemas directly — it uses the `@shared/types` alias. Add a `RateLimitInfo` type inline or to a shared UI types file. Simplest: define it inline in the store since it's the only consumer for now.

Add at the top of `server/ui/src/stores/messages.ts` (after the existing imports):

```typescript
export interface RateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage";
  utilization?: number;
  overageStatus?: "allowed" | "allowed_warning" | "rejected";
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}
```

**Step 2: Add state field to MessagesState**

In the `MessagesState` interface (after line 99, `gitDiffStat`):

```typescript
  // Subscription rate limit info (account-level, from SDK events)
  rateLimitInfo: RateLimitInfo | null;
```

Also add the initial value in the `create` call's initial state object:

```typescript
  rateLimitInfo: null,
```

**Step 3: Add WS message handler case**

In the `socket.onmessage` switch statement, after the `case "git_diff_stat"` block (after line 467), add:

```typescript
          case "rate_limit": {
            const info: RateLimitInfo = {
              status: msg.status,
              ...(msg.rateLimitType ? { rateLimitType: msg.rateLimitType } : {}),
              ...(msg.utilization !== undefined ? { utilization: msg.utilization } : {}),
              ...(msg.resetsAt !== undefined ? { resetsAt: msg.resetsAt } : {}),
              ...(msg.overageStatus ? { overageStatus: msg.overageStatus } : {}),
              ...(msg.overageResetsAt !== undefined ? { overageResetsAt: msg.overageResetsAt } : {}),
              ...(msg.overageDisabledReason ? { overageDisabledReason: msg.overageDisabledReason } : {}),
              ...(msg.isUsingOverage !== undefined ? { isUsingOverage: msg.isUsingOverage } : {}),
              ...(msg.surpassedThreshold !== undefined ? { surpassedThreshold: msg.surpassedThreshold } : {}),
            };
            set({ rateLimitInfo: info });

            // Fire toast on warning/rejected — deduplicate by type+status
            if (info.status === "allowed_warning" || info.status === "rejected") {
              const key = `${info.rateLimitType ?? "unknown"}:${info.status}`;
              if (key !== lastRateLimitToastKey) {
                lastRateLimitToastKey = key;
                fireRateLimitToast(info);
              }
            }
            break;
          }
```

**Step 4: Add toast helper and deduplication**

Add above the `create` call (module-level):

```typescript
import { toast } from "sonner";

let lastRateLimitToastKey = "";

const RATE_LIMIT_LABELS: Record<string, string> = {
  five_hour: "session limit",
  seven_day: "weekly limit",
  seven_day_opus: "Opus limit",
  seven_day_sonnet: "Sonnet limit",
  overage: "extra usage",
};

function formatResetTime(resetsAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = resetsAt - now;
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function fireRateLimitToast(info: RateLimitInfo): void {
  const label = RATE_LIMIT_LABELS[info.rateLimitType ?? ""] ?? "usage limit";
  const pct = info.utilization !== undefined ? Math.floor(info.utilization * 100) : null;
  const resetStr = info.resetsAt ? ` · resets in ${formatResetTime(info.resetsAt)}` : "";

  if (info.status === "rejected") {
    toast.error(`${label.charAt(0).toUpperCase() + label.slice(1)} reached${resetStr}`);
  } else if (pct !== null) {
    toast.warning(`You've used ${pct}% of your ${label}${resetStr}`);
  } else {
    toast.warning(`Approaching ${label}${resetStr}`);
  }
}
```

**Step 5: Run type check**

Run: `cd server/ui && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add server/ui/src/stores/messages.ts
git commit -m "feat: handle rate_limit WS events in UI store with toast"
```

---

### Task 9: Settings Page — Usage Card

**Files:**
- Modify: `server/ui/src/pages/SettingsPage.tsx` (add Usage card between Claude and Terminal)

**Step 1: Add the Usage card**

In `server/ui/src/pages/SettingsPage.tsx`:

Add imports at top:

```typescript
import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/auth";
import { Gauge } from "lucide-react";
import type { RateLimitInfo } from "@/stores/messages";
```

Add a type and helper functions before the component:

```typescript
interface CachedRateLimits {
  info: RateLimitInfo;
  lastUpdated: string;
}

const RATE_LIMIT_LABELS: Record<string, string> = {
  five_hour: "Session limit",
  seven_day: "Weekly limit",
  seven_day_opus: "Opus limit",
  seven_day_sonnet: "Sonnet limit",
  overage: "Extra usage",
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatResetTime(resetsAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = resetsAt - now;
  if (diff <= 0) return "resetting now";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `resets in ${hours}h ${mins}m`;
  return `resets in ${mins}m`;
}

function barColor(utilization: number): string {
  const pct = utilization * 100;
  if (pct >= 90) return "bg-red-400";
  if (pct >= 75) return "bg-amber-400";
  return "bg-emerald-400";
}
```

Inside the `SettingsPage` component, add state and fetch logic:

```typescript
  const token = useAuthStore((s) => s.token);
  const [rateLimits, setRateLimits] = useState<CachedRateLimits | null>(null);
  const [rateLimitsLoading, setRateLimitsLoading] = useState(true);

  const fetchRateLimits = useCallback(async () => {
    try {
      const res = await fetch("/api/rate-limits", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 204) {
        setRateLimits(null);
      } else if (res.ok) {
        setRateLimits(await res.json());
      }
    } catch {
      // Silently fail — non-critical
    } finally {
      setRateLimitsLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchRateLimits(); }, [fetchRateLimits]);
```

Add the Usage card JSX between the Claude card and Terminal card (after line 164, before `{/* Terminal */}`):

```tsx
        {/* Usage */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <CardTitle>Usage</CardTitle>
            </div>
            <CardDescription>Subscription rate limits from your Claude account.</CardDescription>
          </CardHeader>
          <CardContent>
            {rateLimitsLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : !rateLimits ? (
              <p className="text-sm text-muted-foreground">
                No usage data available — rate limits are reported after your first session.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {rateLimits.info.rateLimitType && rateLimits.info.utilization !== undefined && (
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">
                        {RATE_LIMIT_LABELS[rateLimits.info.rateLimitType] ?? rateLimits.info.rateLimitType}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {Math.floor(rateLimits.info.utilization * 100)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor(rateLimits.info.utilization))}
                        style={{ width: `${Math.min(100, rateLimits.info.utilization * 100)}%` }}
                      />
                    </div>
                    {rateLimits.info.resetsAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatResetTime(rateLimits.info.resetsAt)}
                      </p>
                    )}
                  </div>
                )}
                {rateLimits.info.isUsingOverage && (
                  <p className="text-xs text-amber-400">Using extra usage</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Last updated {formatRelativeTime(rateLimits.lastUpdated)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
```

**Step 2: Run type check**

Run: `cd server/ui && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add server/ui/src/pages/SettingsPage.tsx
git commit -m "feat: add Usage card to Settings page with progress bars"
```

---

### Task 10: E2E Test — Rate Limit via Test Provider

**Files:**
- Modify: `tests/session-delivery.spec.ts` (add rate-limit test case)

**Step 1: Add test case**

Add a new test to `tests/session-delivery.spec.ts`, following the pattern of the existing `thinking` scenario test. The test:

1. Creates a session with prompt `[rate-limit] hello`
2. Connects a WS client
3. Verifies a `{ type: "rate_limit", status: "allowed_warning", rateLimitType: "five_hour", ... }` event arrives

```typescript
test("rate limit events are delivered via WebSocket", async ({ request }) => {
  // Create session with rate-limit scenario
  const createRes = await request.post(`${BASE}/api/sessions`, {
    headers: { Authorization: `Bearer ${PASSWORD}` },
    data: { prompt: "[rate-limit] hello", provider: "test" },
  });
  expect(createRes.ok()).toBeTruthy();
  const { id } = await createRes.json();

  // Connect WS and collect messages
  const ws = new WebSocket(`${WS_BASE}/api/sessions/${id}/stream`);
  const messages: Record<string, unknown>[] = [];

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS timeout")), 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: PASSWORD }));
    };
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data as string);
      messages.push(msg);
      if (msg.type === "status" && (msg.status === "completed" || msg.status === "error")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    ws.onerror = (err) => { clearTimeout(timeout); reject(err); };
  });

  ws.close();

  // Verify rate_limit event was received
  const rateLimitMsg = messages.find((m) => m.type === "rate_limit");
  expect(rateLimitMsg).toBeDefined();
  expect(rateLimitMsg!.status).toBe("allowed_warning");
  expect(rateLimitMsg!.rateLimitType).toBe("five_hour");
  expect(rateLimitMsg!.utilization).toBe(0.82);
  expect(rateLimitMsg!.resetsAt).toBeGreaterThan(0);
});
```

**Step 2: Commit**

```bash
git add tests/session-delivery.spec.ts
git commit -m "test: add rate limit e2e test for session-delivery"
```

---

### Task 11: Build + Full Test Suite

**Step 1: Rebuild server**

Run: `cd server && npm run build`
Expected: PASS

**Step 2: Run vitest**

Run: `cd server && npx vitest run`
Expected: All tests pass (including new rate-limit tests)

**Step 3: Run ESLint**

Run: `cd server && npm run lint && cd ui && npm run lint`
Expected: PASS

**Step 4: Commit any lint fixes if needed**

```bash
git add -A && git commit -m "chore: lint fixes for rate limit feature"
```

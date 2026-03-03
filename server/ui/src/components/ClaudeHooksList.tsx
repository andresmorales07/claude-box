import { useEffect } from "react";
import {
  useClaudeHooksStore,
  type HookEventName,
  type HookConfig,
} from "@/stores/claude-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HookEventCard } from "@/components/HookEventCard";
import { Settings2 } from "lucide-react";

interface ClaudeHooksListProps {
  onAdd: () => void;
  onEdit: (event: HookEventName, groupIdx: number, handlerIdx: number) => void;
}

export function ClaudeHooksList({ onAdd, onEdit }: ClaudeHooksListProps) {
  const {
    scope,
    workspacePath,
    hooks,
    knownWorkspaces,
    loading,
    error,
    setScope,
    fetchHooks,
    fetchWorkspaces,
    removeHandler,
  } = useClaudeHooksStore();

  useEffect(() => {
    fetchWorkspaces();
    fetchHooks();
  }, [fetchWorkspaces, fetchHooks]);

  const hookEntries = Object.entries(hooks) as [HookEventName, HookConfig[HookEventName]][];
  const hasHooks = hookEntries.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" /> Claude Code Hooks
        </CardTitle>
        <Button size="sm" onClick={onAdd}>
          Add Hook
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Scope selector */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={scope === "user" ? "default" : "outline"}
            size="sm"
            onClick={() => setScope("user")}
          >
            User
          </Button>
          <Button
            variant={scope === "workspace" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const first = knownWorkspaces[0]?.path;
              if (first) {
                setScope("workspace", first);
              }
            }}
            disabled={knownWorkspaces.length === 0}
          >
            Workspace
          </Button>
          {scope === "workspace" && knownWorkspaces.length > 0 && (
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm truncate max-w-[250px]"
              value={workspacePath ?? ""}
              onChange={(e) => setScope("workspace", e.target.value)}
            >
              {knownWorkspaces.map((ws) => (
                <option key={ws.path} value={ws.path}>
                  {ws.path}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* States */}
        {loading && !hasHooks && (
          <p className="text-sm text-muted-foreground">Loading hooks...</p>
        )}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {!loading && !error && !hasHooks && (
          <p className="text-sm text-muted-foreground">
            No hooks configured. Add one to automate Claude Code workflows.
          </p>
        )}

        {/* Hook event cards */}
        {hookEntries.map(([event, groups]) =>
          groups ? (
            <HookEventCard
              key={event}
              event={event}
              groups={groups}
              onEditHandler={(groupIdx, handlerIdx) =>
                onEdit(event, groupIdx, handlerIdx)
              }
              onDeleteHandler={(groupIdx, handlerIdx) =>
                removeHandler(event, groupIdx, handlerIdx)
              }
            />
          ) : null,
        )}
      </CardContent>
    </Card>
  );
}

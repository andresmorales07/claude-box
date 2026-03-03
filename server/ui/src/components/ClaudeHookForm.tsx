import { useState } from "react";
import {
  useClaudeHooksStore,
  HOOK_EVENT_NAMES,
  type HookEventName,
  type HookHandler,
  type CommandHook,
  type HttpHook,
} from "@/stores/claude-hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface EditingHook {
  event: HookEventName;
  groupIdx: number;
  handlerIdx: number;
  matcher?: string;
  handler: HookHandler;
}

interface ClaudeHookFormProps {
  open: boolean;
  onClose: () => void;
  editing: EditingHook | null;
}

function ClaudeHookFormBody({
  editing,
  onClose,
}: {
  editing: EditingHook | null;
  onClose: () => void;
}) {
  const { addHandler, updateHandler } = useClaudeHooksStore();

  const isEditing = editing !== null;

  const [event, setEvent] = useState<HookEventName>(
    editing?.event ?? HOOK_EVENT_NAMES[0],
  );
  const [matcher, setMatcher] = useState(editing?.matcher ?? "");
  const [type, setType] = useState<"command" | "http">(
    editing?.handler.type ?? "command",
  );

  // Command fields
  const editingCmd = editing?.handler.type === "command" ? editing.handler : null;
  const [command, setCommand] = useState(editingCmd?.command ?? "");
  const [asyncMode, setAsyncMode] = useState(editingCmd?.async ?? false);
  const [cmdTimeout, setCmdTimeout] = useState(
    editingCmd?.timeout != null ? String(editingCmd.timeout) : "",
  );
  const [cmdStatusMessage, setCmdStatusMessage] = useState(
    editingCmd?.statusMessage ?? "",
  );

  // HTTP fields
  const editingHttp = editing?.handler.type === "http" ? editing.handler : null;
  const [url, setUrl] = useState(editingHttp?.url ?? "");
  const [headers, setHeaders] = useState(
    editingHttp?.headers
      ? JSON.stringify(editingHttp.headers, null, 2)
      : "",
  );
  const [allowedEnvVars, setAllowedEnvVars] = useState(
    editingHttp?.allowedEnvVars?.join(", ") ?? "",
  );
  const [httpTimeout, setHttpTimeout] = useState(
    editingHttp?.timeout != null ? String(editingHttp.timeout) : "",
  );
  const [httpStatusMessage, setHttpStatusMessage] = useState(
    editingHttp?.statusMessage ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Validation
  const isValidUrl = (() => {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  })();

  const isValid =
    type === "command"
      ? command.trim().length > 0
      : isValidUrl;

  const buildHandler = (): HookHandler => {
    if (type === "command") {
      const h: CommandHook = { type: "command", command: command.trim() };
      if (asyncMode) h.async = true;
      const t = parseInt(cmdTimeout, 10);
      if (!isNaN(t) && t > 0) h.timeout = t;
      const sm = cmdStatusMessage.trim();
      if (sm) h.statusMessage = sm;
      return h;
    } else {
      const h: HttpHook = { type: "http", url: url.trim() };
      // Parse headers JSON
      if (headers.trim()) {
        try {
          const parsed = JSON.parse(headers);
          if (typeof parsed === "object" && parsed !== null) {
            h.headers = parsed;
          }
        } catch {
          /* ignore invalid JSON */
        }
      }
      // Parse allowedEnvVars
      const envVars = allowedEnvVars
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (envVars.length > 0) h.allowedEnvVars = envVars;
      const t = parseInt(httpTimeout, 10);
      if (!isNaN(t) && t > 0) h.timeout = t;
      const sm = httpStatusMessage.trim();
      if (sm) h.statusMessage = sm;
      return h;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const handler = buildHandler();
      if (isEditing) {
        await updateHandler(
          editing.event,
          editing.groupIdx,
          editing.handlerIdx,
          handler,
        );
      } else {
        await addHandler(event, matcher.trim() || undefined, handler);
      }
      // Check if store has an error after the operation
      const storeError = useClaudeHooksStore.getState().error;
      if (storeError) {
        setSaveError(storeError);
      } else {
        onClose();
      }
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit Hook" : "Add Hook"}</DialogTitle>
        <DialogDescription className="sr-only">
          {isEditing
            ? "Modify hook handler settings"
            : "Configure a new hook handler"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Event */}
        <div>
          <label className="text-sm font-medium" htmlFor="hook-event">
            Event
          </label>
          <select
            id="hook-event"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={event}
            onChange={(e) => setEvent(e.target.value as HookEventName)}
            disabled={isEditing}
          >
            {HOOK_EVENT_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Matcher */}
        <div>
          <label className="text-sm font-medium" htmlFor="hook-matcher">
            Matcher{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            id="hook-matcher"
            value={matcher}
            onChange={(e) => setMatcher(e.target.value)}
            placeholder="e.g. Bash, Edit|Write, mcp__.*"
            disabled={isEditing}
          />
        </div>

        {/* Type toggle */}
        <div>
          <label className="text-sm font-medium block mb-1">Type</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={type === "command" ? "default" : "outline"}
              size="sm"
              onClick={() => setType("command")}
            >
              Command
            </Button>
            <Button
              type="button"
              variant={type === "http" ? "default" : "outline"}
              size="sm"
              onClick={() => setType("http")}
            >
              HTTP
            </Button>
          </div>
        </div>

        {/* Command fields */}
        {type === "command" && (
          <>
            <div>
              <label className="text-sm font-medium" htmlFor="hook-command">
                Command
              </label>
              <textarea
                id="hook-command"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                rows={3}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. npm run lint"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={asyncMode}
                  onChange={(e) => setAsyncMode(e.target.checked)}
                />
                Run in background
              </label>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="hook-cmd-timeout">
                Timeout (seconds)
              </label>
              <Input
                id="hook-cmd-timeout"
                type="number"
                value={cmdTimeout}
                onChange={(e) => setCmdTimeout(e.target.value)}
                placeholder="600"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label
                className="text-sm font-medium"
                htmlFor="hook-cmd-status"
              >
                Status message{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                id="hook-cmd-status"
                value={cmdStatusMessage}
                onChange={(e) => setCmdStatusMessage(e.target.value)}
                placeholder="Custom status message..."
              />
            </div>
          </>
        )}

        {/* HTTP fields */}
        {type === "http" && (
          <>
            <div>
              <label className="text-sm font-medium" htmlFor="hook-url">
                URL
              </label>
              <Input
                id="hook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
              {url.trim().length > 0 && !isValidUrl && (
                <p className="text-xs text-destructive mt-1">
                  Please enter a valid URL
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="hook-headers">
                Headers{" "}
                <span className="text-muted-foreground font-normal">
                  (JSON object, optional)
                </span>
              </label>
              <textarea
                id="hook-headers"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                rows={3}
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                placeholder='{"Content-Type": "application/json"}'
              />
            </div>
            <div>
              <label
                className="text-sm font-medium"
                htmlFor="hook-env-vars"
              >
                Allowed env vars{" "}
                <span className="text-muted-foreground font-normal">
                  (comma-separated, optional)
                </span>
              </label>
              <Input
                id="hook-env-vars"
                value={allowedEnvVars}
                onChange={(e) => setAllowedEnvVars(e.target.value)}
                placeholder="TOKEN, SECRET"
              />
            </div>
            <div>
              <label
                className="text-sm font-medium"
                htmlFor="hook-http-timeout"
              >
                Timeout (seconds)
              </label>
              <Input
                id="hook-http-timeout"
                type="number"
                value={httpTimeout}
                onChange={(e) => setHttpTimeout(e.target.value)}
                placeholder="30"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label
                className="text-sm font-medium"
                htmlFor="hook-http-status"
              >
                Status message{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                id="hook-http-status"
                value={httpStatusMessage}
                onChange={(e) => setHttpStatusMessage(e.target.value)}
                placeholder="Custom status message..."
              />
            </div>
          </>
        )}

        {saveError && (
          <p className="text-xs text-destructive">{saveError}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!isValid || saving}>
          {saving ? "Saving..." : isEditing ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ClaudeHookForm({ open, onClose, editing }: ClaudeHookFormProps) {
  const formKey = editing
    ? `${editing.event}-${editing.groupIdx}-${editing.handlerIdx}`
    : "new";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {open && (
          <ClaudeHookFormBody
            key={formKey}
            editing={editing}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

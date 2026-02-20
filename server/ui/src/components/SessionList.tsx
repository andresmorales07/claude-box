import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SessionSummary {
  id: string;
  status: string;
  createdAt: string;
  lastModified: string;
  numTurns: number;
  totalCostUsd: number;
  hasPendingApproval: boolean;
  provider: string;
  slug: string | null;
  summary: string | null;
}

interface Props {
  token: string;
  cwd: string;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onResumeSession: (historySessionId: string) => void;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sessionDisplayName(s: SessionSummary): string {
  if (s.slug) return s.slug;
  if (s.summary) return s.summary;
  return s.id.slice(0, 8);
}

const statusStyles: Record<string, string> = {
  idle: "bg-emerald-500/15 text-emerald-400 border-transparent",
  running: "bg-amber-500/15 text-amber-400 border-transparent",
  starting: "bg-amber-500/15 text-amber-400 border-transparent",
  error: "bg-red-400/15 text-red-400 border-transparent",
  disconnected: "bg-red-400/15 text-red-400 border-transparent",
  completed: "bg-muted-foreground/15 text-muted-foreground border-transparent",
  history: "bg-muted-foreground/10 text-muted-foreground italic border-transparent",
};

export function SessionList({ token, cwd, activeSessionId, onSelectSession, onResumeSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const res = await fetch(`/api/sessions${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSessions(await res.json());
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  }, [token, cwd]);

  useEffect(() => { fetchSessions(); const interval = setInterval(fetchSessions, 5000); return () => clearInterval(interval); }, [fetchSessions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.trim(), cwd }) });
      if (res.ok) { const session = await res.json(); setPrompt(""); onSelectSession(session.id); fetchSessions(); }
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally { setCreating(false); }
  };

  const handleClick = (s: SessionSummary) => {
    if (s.status === "history") {
      onResumeSession(s.id);
    } else {
      onSelectSession(s.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        {sessions.length === 0 && <p className="p-4 text-muted-foreground">No sessions yet</p>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex justify-between items-center px-4 py-3 cursor-pointer border-b border-border hover:bg-accent",
              s.id === activeSessionId && "bg-accent border-l-[3px] border-l-primary"
            )}
            onClick={() => handleClick(s)}
          >
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="text-[0.8125rem] font-medium truncate">{sessionDisplayName(s)}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[0.6875rem] text-muted-foreground">{relativeTime(s.lastModified || s.createdAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Badge variant="secondary" className="text-[0.5625rem] font-semibold uppercase tracking-wide px-1.5 py-0">
                {s.provider}
              </Badge>
              <Badge variant="outline" className={cn("text-[0.75rem] font-semibold uppercase tracking-wide", statusStyles[s.status])}>
                {s.status}
              </Badge>
            </div>
          </div>
        ))}
      </ScrollArea>
      <form className="flex gap-2 p-3 border-t border-border" onSubmit={handleCreate}>
        <Input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="New session prompt..."
          disabled={creating}
          className="flex-1"
        />
        <Button type="submit" disabled={creating || !prompt.trim()} size="sm">
          {creating ? "..." : "New"}
        </Button>
      </form>
    </div>
  );
}

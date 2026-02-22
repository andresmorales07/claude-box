import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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
  session: SessionSummary;
  isActive: boolean;
  onClick: () => void;
}

const statusDot: Record<string, string> = {
  idle: "bg-emerald-400",
  running: "bg-amber-400 animate-pulse",
  starting: "bg-amber-400 animate-pulse",
  error: "bg-red-400",
  completed: "bg-zinc-500",
  history: "border border-zinc-500 bg-transparent",
};

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

export function SessionCard({ session, isActive, onClick }: Props) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
        "hover:bg-accent/50 active:bg-accent",
        isActive && "bg-accent border-l-2 border-l-primary"
      )}
      onClick={onClick}
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", statusDot[session.status] ?? "bg-zinc-500")} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{sessionDisplayName(session)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {relativeTime(session.lastModified || session.createdAt)}
          {session.numTurns > 0 && ` · ${session.numTurns} turns`}
        </div>
      </div>
      {session.hasPendingApproval && (
        <Badge variant="destructive" className="text-[0.625rem] px-1.5 py-0 shrink-0">!</Badge>
      )}
    </button>
  );
}

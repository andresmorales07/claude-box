import { useState } from "react";
import type { ToolSummaryMessage } from "@shared/types";
import { cn } from "@/lib/utils";
import { ChevronDown, ListChecks } from "lucide-react";

interface Props {
  message: ToolSummaryMessage;
}

export function ToolSummaryCard({ message }: Props) {
  const [expanded, setExpanded] = useState(false);
  const count = message.precedingToolUseIds.length;

  return (
    <div className="max-w-[85%] md:max-w-[70%]">
      <div className="rounded-lg border border-border bg-card/30 overflow-hidden text-sm">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <ListChecks className="size-3.5 text-amber-400/70 shrink-0" />
          <span className="flex-1 text-muted-foreground text-xs">
            {count} tool {count === 1 ? "use" : "uses"} summarized
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        {expanded && (
          <div className="border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {message.summary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

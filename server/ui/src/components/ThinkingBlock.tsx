import { useState } from "react";
import { cn } from "@/lib/utils";

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

  const duration = durationMs != null ? formatDuration(durationMs) : null;
  const labelText = duration != null ? `${label} ${duration}` : label;

  return (
    <div className="self-start max-w-[90%] md:max-w-[70%]">
      <button
        className="flex items-center gap-2 bg-transparent border-none text-muted-foreground text-[0.8125rem] cursor-pointer py-1.5 px-0 transition-colors duration-200 hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${labelText} - click to ${expanded ? "collapse" : "expand"} thinking details`}
      >
        <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-muted-foreground" />
        <span className="whitespace-nowrap">{labelText}</span>
        <span className={cn("text-[0.625rem] transition-transform duration-200 ml-auto", expanded && "rotate-90")} aria-hidden="true">
          &#9656;
        </span>
      </button>
      {expanded && (
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground border-l-2 border-border pl-3 py-2 ml-[3px] my-1 max-h-[300px] overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  );
}

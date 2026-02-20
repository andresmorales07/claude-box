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

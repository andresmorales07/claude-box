import { useState, useEffect } from "react";

function extractSnippet(text: string): string {
  if (!text.trim()) return "Thinking...";
  // Take the last non-empty line, truncate to 80 chars
  const lines = text.split("\n").filter((l) => l.trim());
  const last = lines[lines.length - 1] || "Thinking...";
  return last.length > 80 ? last.slice(0, 77) + "..." : last;
}

interface Props {
  thinkingText: string;
  startTime: number;
}

export function ThinkingIndicator({ thinkingText, startTime }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const snippet = extractSnippet(thinkingText);

  return (
    <div className="thinking-indicator">
      <span className="thinking-dot active" />
      <span className="thinking-text">{snippet}</span>
      <span className="thinking-elapsed">{elapsed}s</span>
    </div>
  );
}

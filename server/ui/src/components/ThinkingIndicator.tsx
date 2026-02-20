import { useState, useEffect } from "react";

function extractSnippet(text: string): string {
  if (!text.trim()) return "Thinking...";
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
    <div className="flex items-center gap-2 py-2 text-[0.8125rem] self-start">
      <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-primary animate-pulse" />
      <span className="text-primary italic overflow-hidden text-ellipsis whitespace-nowrap max-w-[500px]">{snippet}</span>
      <span className="text-muted-foreground text-xs whitespace-nowrap ml-auto">{elapsed}s</span>
    </div>
  );
}

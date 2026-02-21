import type { NormalizedMessage, MessagePart } from "../types";
import { ThinkingBlock } from "./ThinkingBlock";
import { Markdown } from "./Markdown";

interface Props {
  message: NormalizedMessage;
  thinkingDurationMs: number | null;
}

function renderPart(part: MessagePart, i: number, thinkingDurationMs: number | null) {
  switch (part.type) {
    case "text":
      return (
        <div key={i} className="p-3 rounded-lg max-w-[90%] md:max-w-[70%] break-words bg-card border border-border self-start rounded-bl-sm text-sm">
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "tool_use":
      return (
        <div key={i} className="p-3 rounded-lg bg-[#0d1b2a] border border-border self-start text-[0.8125rem] max-w-[90%] md:max-w-[70%] break-words">
          <strong className="text-amber-400">{part.toolName}</strong>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-snug text-muted-foreground">{JSON.stringify(part.input, null, 2)}</pre>
        </div>
      );
    case "tool_result":
      return (
        <div key={i} className="p-3 rounded-lg bg-[#0d1b2a] border border-border self-start text-[0.8125rem] max-w-[90%] md:max-w-[70%] break-words">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-snug text-muted-foreground">{part.output}</pre>
        </div>
      );
    case "reasoning":
      return <ThinkingBlock key={i} text={part.text} durationMs={thinkingDurationMs} />;
    case "error":
      return <div key={i} className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive self-start max-w-[90%] md:max-w-[70%] break-words">{part.message}</div>;
    default:
      return null;
  }
}

export function MessageBubble({ message, thinkingDurationMs }: Props) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!text) return null;
    return <div className="p-3 rounded-lg max-w-[90%] md:max-w-[70%] break-words bg-secondary self-end rounded-br-sm">{text}</div>;
  }

  if (message.role === "assistant") {
    return <>{message.parts.map((part, i) => renderPart(part, i, thinkingDurationMs))}</>;
  }

  if (message.role === "system" && message.event.type === "session_result") {
    return (
      <div className="p-3 rounded-lg max-w-[90%] md:max-w-[70%] break-words bg-card border border-border self-start rounded-bl-sm">
        <em>Session completed. Cost: ${message.event.totalCostUsd.toFixed(4)}, Turns: {message.event.numTurns}</em>
      </div>
    );
  }

  return null;
}

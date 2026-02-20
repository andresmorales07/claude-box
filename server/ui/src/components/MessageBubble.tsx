import type { NormalizedMessage, MessagePart } from "../types";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  message: NormalizedMessage;
  thinkingDurationMs: number | null;
}

function renderPart(part: MessagePart, i: number, thinkingDurationMs: number | null) {
  switch (part.type) {
    case "text":
      return <pre key={i}>{part.text}</pre>;
    case "tool_use":
      return (
        <div key={i} className="message tool">
          <strong>{part.toolName}</strong>
          <pre>{JSON.stringify(part.input, null, 2)}</pre>
        </div>
      );
    case "tool_result":
      return (
        <div key={i} className="message tool">
          <pre>{part.output}</pre>
        </div>
      );
    case "reasoning":
      return <ThinkingBlock key={i} text={part.text} durationMs={thinkingDurationMs} />;
    case "error":
      return <div key={i} className="message error">{part.message}</div>;
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
    return <div className="message user">{text}</div>;
  }

  if (message.role === "assistant") {
    return <>{message.parts.map((part, i) => renderPart(part, i, thinkingDurationMs))}</>;
  }

  if (message.role === "system" && message.event.type === "session_result") {
    return (
      <div className="message assistant">
        <em>Session completed. Cost: ${message.event.totalCostUsd.toFixed(4)}, Turns: {message.event.numTurns}</em>
      </div>
    );
  }

  return null;
}

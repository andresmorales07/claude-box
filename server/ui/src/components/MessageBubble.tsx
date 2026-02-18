interface Props { message: unknown; }

// SDK message shape helpers
interface ContentBlock { type: string; text?: string; name?: string; id?: string; input?: unknown; }
interface ApiMessage { role?: string; content?: string | ContentBlock[]; }
interface SDKEnvelope { type: string; message?: ApiMessage; [key: string]: unknown; }

function getContent(msg: SDKEnvelope): ContentBlock[] | null {
  // SDKAssistantMessage / SDKUserMessage wrap the API message in .message
  const inner = msg.message;
  if (inner && Array.isArray(inner.content)) return inner.content as ContentBlock[];
  // Fallback: direct content array (shouldn't happen with current SDK, but safe)
  if (Array.isArray((msg as Record<string, unknown>).content)) return (msg as Record<string, unknown>).content as ContentBlock[];
  return null;
}

export function MessageBubble({ message }: Props) {
  if (!message || typeof message !== "object") return null;
  const msg = message as SDKEnvelope;

  // SDKAssistantMessage: { type: "assistant", message: { role: "assistant", content: [...] } }
  if (msg.type === "assistant") {
    const content = getContent(msg);
    if (!content) return null;

    const textParts = content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("");
    const toolUses = content.filter((c) => c.type === "tool_use");

    return (
      <>
        {textParts && <div className="message assistant"><pre>{textParts}</pre></div>}
        {toolUses.map((tool, i) => (
          <div key={i} className="message tool">
            <strong>{tool.name}</strong>
            <pre>{JSON.stringify(tool.input, null, 2)}</pre>
          </div>
        ))}
      </>
    );
  }

  // SDKUserMessage: { type: "user", message: { role: "user", content: "..." | [...] } }
  if (msg.type === "user") {
    const inner = msg.message;
    if (!inner) return null;
    const text = typeof inner.content === "string"
      ? inner.content
      : Array.isArray(inner.content)
        ? (inner.content as ContentBlock[]).map((c) => c.text ?? "").join("")
        : JSON.stringify(inner.content);
    if (!text) return null;
    return <div className="message user">{text}</div>;
  }

  // SDKResultMessage: { type: "result", total_cost_usd, num_turns, ... }
  if (msg.type === "result") {
    const cost = msg.total_cost_usd as number | undefined;
    const turns = msg.num_turns as number | undefined;
    return (
      <div className="message assistant">
        <em>Session completed. Cost: ${cost?.toFixed(4) ?? "?"}, Turns: {turns ?? "?"}</em>
      </div>
    );
  }

  // Skip stream_event, tool_progress, tool_use_summary, status, and other SDK envelope types
  return null;
}

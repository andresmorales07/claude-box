import { useState } from "react";
import type { NormalizedMessage, MessagePart, TextPart, ToolResultPart } from "../types";
import { ThinkingBlock } from "./ThinkingBlock";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import { ChevronDown, Wrench, AlertCircle } from "lucide-react";

/** Clean SDK-internal XML markup that may appear in user messages (defense in depth).
 *  NOTE: Keep in sync with server/src/providers/claude-adapter.ts cleanSdkMarkup(). */
function cleanSdkMarkup(text: string): string {
  // Strip <local-command-caveat>...</local-command-caveat> blocks (LLM-only instructions)
  let cleaned = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");

  // Unwrap <local-command-stdout>...</local-command-stdout> to plain text
  cleaned = cleaned.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, "$1");

  // Convert <command-name>/<cmd></command-name> ... to clean "/cmd args"
  const m = cleaned.match(
    /^\s*<command-name>(\/[^<]+)<\/command-name>\s*<command-message>[\s\S]*?<\/command-message>\s*(?:<command-args>([\s\S]*?)<\/command-args>)?/,
  );
  if (m) {
    const name = m[1].trim();
    const args = m[2]?.trim();
    cleaned = args ? `${name} ${args}` : name;
  }

  return cleaned.trim();
}

interface Props {
  message: NormalizedMessage;
  thinkingDurationMs: number | null;
  toolResults: Map<string, ToolResultPart>;
}

/** Extract a human-readable one-liner from tool input based on tool name. */
function getToolSummary(toolName: string, input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  // Known tool patterns
  const pathTools = ["Read", "Write", "Edit", "NotebookEdit"];
  if (pathTools.some((t) => toolName.includes(t)) && typeof obj.file_path === "string") {
    return obj.file_path;
  }
  if (toolName.includes("Bash") && typeof obj.command === "string") {
    const cmd = obj.command;
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  if ((toolName.includes("Glob") || toolName.includes("Grep")) && typeof obj.pattern === "string") {
    return obj.pattern;
  }
  if (toolName.includes("WebFetch") && typeof obj.url === "string") {
    return obj.url;
  }
  if (toolName.includes("Task") && typeof obj.description === "string") {
    return obj.description;
  }
  if (toolName.includes("WebSearch") && typeof obj.query === "string") {
    return obj.query;
  }

  // Fallback: first string value
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.length > 0) {
      return val.length > 80 ? val.slice(0, 77) + "..." : val;
    }
  }
  return "";
}

function ToolCard({
  toolUse,
  toolResult,
}: {
  toolUse: { type: "tool_use"; toolUseId: string; toolName: string; input: unknown };
  toolResult?: ToolResultPart | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = getToolSummary(toolUse.toolName, toolUse.input);
  const inputJson = JSON.stringify(toolUse.input, null, 2);
  const hasResult = toolResult != null && toolResult.output.length > 0;
  const isError = toolResult?.isError ?? false;

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden text-sm">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="size-3.5 text-amber-400 shrink-0" />
        <span className="font-medium text-amber-400 shrink-0">{toolUse.toolName}</span>
        {summary && (
          <span className="text-muted-foreground truncate text-xs font-mono">{summary}</span>
        )}
        {isError && <AlertCircle className="size-3.5 text-destructive shrink-0" />}
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground ml-auto shrink-0 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {/* Input */}
          <div>
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Input
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-snug text-muted-foreground bg-background/50 rounded p-2 max-h-[200px] overflow-y-auto">
              {inputJson}
            </pre>
          </div>

          {/* Output */}
          {hasResult && (
            <div>
              <div className={cn(
                "text-[0.6875rem] font-semibold uppercase tracking-wider mb-1",
                isError ? "text-destructive" : "text-muted-foreground",
              )}>
                {isError ? "Error" : "Output"}
              </div>
              <pre className={cn(
                "whitespace-pre-wrap font-mono text-xs leading-snug rounded p-2 max-h-[300px] overflow-y-auto",
                isError
                  ? "text-destructive bg-destructive/5 border border-destructive/20"
                  : "text-muted-foreground bg-background/50",
              )}>
                {toolResult!.output}
              </pre>
            </div>
          )}

          {!hasResult && toolResult == null && (
            <div className="text-xs text-muted-foreground italic">Waiting for result...</div>
          )}
        </div>
      )}
    </div>
  );
}

function renderPart(
  part: MessagePart,
  i: number,
  thinkingDurationMs: number | null,
  toolResults: Map<string, ToolResultPart>,
  allParts: MessagePart[],
) {
  switch (part.type) {
    case "text":
      return (
        <div key={i} className="text-sm leading-relaxed">
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "tool_use": {
      const result = toolResults.get(part.toolUseId) ?? null;
      return <ToolCard key={i} toolUse={part} toolResult={result} />;
    }
    case "tool_result":
      // Rendered by the paired ToolCard above — skip standalone rendering
      return null;
    case "reasoning":
      return <ThinkingBlock key={i} text={part.text} durationMs={thinkingDurationMs} />;
    case "error":
      return (
        <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          {part.message}
        </div>
      );
    default:
      return null;
  }
}

export function MessageBubble({ message, thinkingDurationMs, toolResults }: Props) {
  // Hide user messages that only contain tool_result parts (shown inside ToolCard)
  if (message.role === "user") {
    const hasOnlyToolResults = message.parts.every((p) => p.type === "tool_result");
    if (hasOnlyToolResults) return null;
  }

  if (message.role === "user") {
    const text = cleanSdkMarkup(
      message.parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join(""),
    );
    if (!text) return null;

    if (text.startsWith("/")) {
      return (
        <div className="flex justify-end">
          <div className="px-3 py-1.5 rounded-full bg-secondary/60 border border-border text-xs font-mono text-muted-foreground">
            {text}
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-secondary text-sm max-w-[85%] md:max-w-[70%] break-words">
          {text}
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    return (
      <div className="flex flex-col gap-2 max-w-[85%] md:max-w-[70%]">
        {message.parts.map((part, i) => renderPart(part, i, thinkingDurationMs, toolResults, message.parts))}
      </div>
    );
  }

  if (message.role === "system" && message.event.type === "session_result") {
    return (
      <div className="flex justify-center">
        <div className="text-xs text-muted-foreground bg-card/50 border border-border rounded-full px-4 py-1.5">
          Session completed · ${message.event.totalCostUsd.toFixed(4)} · {message.event.numTurns} turns
        </div>
      </div>
    );
  }

  return null;
}

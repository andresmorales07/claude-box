import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { MessageBubble } from "./MessageBubble";
import { ToolApproval } from "./ToolApproval";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { SlashCommandDropdown, getFilteredCommands } from "./SlashCommandDropdown";
import { useSession } from "../hooks/useSession";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";
import type { SlashCommand } from "../types";

interface Props { sessionId: string; token: string; }

const statusStyles: Record<string, string> = {
  idle: "bg-emerald-500/15 text-emerald-400 border-transparent",
  running: "bg-amber-500/15 text-amber-400 border-transparent",
  starting: "bg-amber-500/15 text-amber-400 border-transparent",
  error: "bg-red-400/15 text-red-400 border-transparent",
  disconnected: "bg-red-400/15 text-red-400 border-transparent",
  completed: "bg-muted-foreground/15 text-muted-foreground border-transparent",
  history: "bg-muted-foreground/10 text-muted-foreground italic border-transparent",
};

const SCROLL_THRESHOLD = 100;

export function ChatView({ sessionId, token }: Props) {
  const { messages, slashCommands, status, connected, pendingApproval, thinkingText, thinkingStartTime, thinkingDurations, sendPrompt, approve, approveAlways, deny, interrupt } = useSession(sessionId, token);
  const [input, setInput] = useState("");
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll only when user is at bottom
  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, thinkingText, isAtBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < SCROLL_THRESHOLD);
  }, []);

  const filtered = useMemo(
    () => slashCommands.length > 0 ? getFilteredCommands(slashCommands, input) : [],
    [slashCommands, input],
  );
  const dropdownVisible = filtered.length > 0;

  useEffect(() => { if (dropdownVisible) setDropdownIndex(0); }, [filtered.length, dropdownVisible]);

  const selectCommand = useCallback((cmd: SlashCommand) => {
    setInput(`/${cmd.name} `);
  }, []);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (!input.trim()) return; sendPrompt(input.trim()); setInput(""); setIsAtBottom(true); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dropdownVisible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setDropdownIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setDropdownIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (filtered[dropdownIndex]) {
          selectCommand(filtered[dropdownIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
    }
  };

  const isThinkingActive = thinkingText.length > 0 && thinkingStartTime != null;
  const isDisabled = status === "running" || status === "starting";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Badge variant="outline" className={cn("text-xs font-semibold uppercase tracking-wide", statusStyles[status])}>
          {status}
        </Badge>
        {!connected && (
          <Badge variant="outline" className={cn("text-xs font-semibold uppercase tracking-wide", statusStyles.disconnected)}>
            disconnected
          </Badge>
        )}
        {isDisabled && (
          <Button variant="outline" size="xs" onClick={interrupt} className="ml-auto border-destructive text-destructive hover:bg-destructive hover:text-white">
            Stop
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-4"
        >
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => <MessageBubble key={i} message={msg} thinkingDurationMs={thinkingDurations[i] ?? null} />)}
            {isThinkingActive && <ThinkingIndicator thinkingText={thinkingText} startTime={thinkingStartTime!} />}
            <div ref={messagesEndRef} />
          </div>
        </div>
        {!isAtBottom && (
          <Button
            variant="secondary"
            size="icon-sm"
            className="absolute bottom-4 right-4 rounded-full shadow-lg opacity-80 hover:opacity-100"
            onClick={() => { scrollToBottom(); setIsAtBottom(true); }}
          >
            <ArrowDown className="size-4" />
          </Button>
        )}
      </div>
      {pendingApproval && <ToolApproval toolName={pendingApproval.toolName} toolUseId={pendingApproval.toolUseId} input={pendingApproval.input} onApprove={approve} onApproveAlways={approveAlways} onDeny={deny} />}
      <div className="relative shrink-0">
        {dropdownVisible && (
          <SlashCommandDropdown
            commands={filtered}
            activeIndex={dropdownIndex}
            onSelect={selectCommand}
          />
        )}
        <form className="flex gap-2 px-4 py-3 border-t border-border bg-card shrink-0" onSubmit={handleSubmit}>
          <TextareaAutosize
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            minRows={1}
            maxRows={6}
            disabled={isDisabled}
            className="flex-1 px-3 py-2 rounded-md border border-border bg-input text-foreground text-[0.9375rem] font-[inherit] resize-none outline-none leading-snug focus:border-ring disabled:opacity-50"
          />
          <Button type="submit" disabled={isDisabled} className="self-end">Send</Button>
        </form>
      </div>
    </div>
  );
}

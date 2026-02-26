import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";
import { useSwipe } from "@/hooks/useSwipe";
import { useIsDesktop } from "@/hooks/useMediaQuery";

interface Props {
  toolName: string; toolUseId: string; input: unknown;
  onApprove: (toolUseId: string, answers?: Record<string, string>) => void;
  onApproveAlways: (toolUseId: string) => void;
  onDeny: (toolUseId: string) => void;
}

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

function isAskUserQuestion(input: unknown): input is { questions: Question[] } {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  return Array.isArray(obj.questions) && obj.questions.length > 0 &&
    obj.questions.every((q: unknown) => {
      if (!q || typeof q !== "object") return false;
      const qObj = q as Record<string, unknown>;
      return typeof qObj.question === "string" &&
        Array.isArray(qObj.options) &&
        qObj.options.every((o: unknown) =>
          !!o && typeof o === "object" && typeof (o as Record<string, unknown>).label === "string"
        );
    });
}

interface ApprovalField {
  label: string;
  value: string;
  mono?: boolean;
  chip?: boolean;
}

interface ApprovalDisplay {
  primaryLabel: string;
  fields: ApprovalField[];
}

function truncateApproval(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function getApprovalDisplay(toolName: string, input: unknown): ApprovalDisplay {
  const obj = (input != null && typeof input === "object" && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};

  if (toolName === "Bash" && typeof obj.command === "string") {
    const description = typeof obj.description === "string"
      ? obj.description
      : truncateApproval(obj.command);
    return {
      primaryLabel: description,
      fields: [{ label: "command", value: truncateApproval(obj.command, 200), mono: true, chip: true }],
    };
  }

  if (toolName === "Read" && typeof obj.file_path === "string") {
    return {
      primaryLabel: "Read file",
      fields: [{ label: "path", value: obj.file_path, mono: true }],
    };
  }

  if (toolName === "Write" && typeof obj.file_path === "string") {
    const fields: ApprovalField[] = [{ label: "path", value: obj.file_path, mono: true }];
    if (typeof obj.content === "string" && obj.content.length > 0) {
      fields.push({ label: "content", value: truncateApproval(obj.content, 160), mono: true });
    }
    return { primaryLabel: "Write file", fields };
  }

  if (toolName === "Edit" && typeof obj.file_path === "string") {
    const fields: ApprovalField[] = [{ label: "path", value: obj.file_path, mono: true }];
    if (typeof obj.new_string === "string" && obj.new_string.length > 0) {
      fields.push({ label: "new content", value: truncateApproval(obj.new_string, 160), mono: true });
    }
    return { primaryLabel: "Edit file", fields };
  }

  if (toolName === "Glob" && typeof obj.pattern === "string") {
    const fields: ApprovalField[] = [{ label: "pattern", value: obj.pattern, mono: true, chip: true }];
    if (typeof obj.path === "string") {
      fields.push({ label: "in", value: obj.path, mono: true });
    }
    return { primaryLabel: "Find files", fields };
  }

  if (toolName === "Grep" && typeof obj.pattern === "string") {
    const fields: ApprovalField[] = [{ label: "pattern", value: obj.pattern, mono: true, chip: true }];
    if (typeof obj.path === "string") {
      fields.push({ label: "in", value: obj.path, mono: true });
    }
    return { primaryLabel: "Search in files", fields };
  }

  if (toolName === "WebFetch" && typeof obj.url === "string") {
    const fields: ApprovalField[] = [{ label: "url", value: truncateApproval(obj.url, 120), mono: true }];
    if (typeof obj.prompt === "string" && obj.prompt.length > 0) {
      fields.push({ label: "prompt", value: truncateApproval(obj.prompt, 100) });
    }
    return { primaryLabel: "Fetch URL", fields };
  }

  if (toolName === "WebSearch" && typeof obj.query === "string") {
    return {
      primaryLabel: "Web search",
      fields: [{ label: "query", value: obj.query, chip: true }],
    };
  }

  if (toolName === "Task" && typeof obj.description === "string") {
    const fields: ApprovalField[] = [{ label: "task", value: truncateApproval(obj.description, 200) }];
    if (typeof obj.subagent_type === "string") {
      fields.push({ label: "agent", value: obj.subagent_type, mono: true });
    }
    return { primaryLabel: "Run subagent", fields };
  }

  const fields: ApprovalField[] = Object.entries(obj)
    .filter(([, v]) => typeof v === "string" && (v as string).length > 0)
    .slice(0, 6)
    .map(([k, v]) => ({ label: k, value: truncateApproval(v as string, 120), mono: true }));
  return { primaryLabel: toolName, fields };
}

function ToolInputDisplay({ toolName, input }: { toolName: string; input: unknown }) {
  const display = getApprovalDisplay(toolName, input);
  return (
    <div className="mb-3 space-y-1.5">
      {display.primaryLabel !== toolName && (
        <p className="text-sm text-foreground leading-snug">{display.primaryLabel}</p>
      )}
      {display.fields.map((field) =>
        field.chip ? (
          <div key={field.label} className="flex items-start gap-2">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-0.5 w-14 shrink-0">
              {field.label}
            </span>
            <code className="flex-1 px-2 py-0.5 rounded bg-background/70 font-mono text-xs text-foreground border border-border/60 break-all">
              {field.value}
            </code>
          </div>
        ) : (
          <div key={field.label} className="flex items-start gap-2">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-0.5 w-14 shrink-0">
              {field.label}
            </span>
            <span className={cn(
              "flex-1 text-xs text-muted-foreground break-all leading-snug",
              field.mono && "font-mono"
            )}>
              {field.value}
            </span>
          </div>
        )
      )}
    </div>
  );
}

const OTHER_KEY = "\0__other__";

function AskUserQuestionUI({ questions, toolUseId, onApprove, onDeny }: {
  questions: Question[]; toolUseId: string;
  onApprove: Props["onApprove"]; onDeny: Props["onDeny"];
}) {
  const [selections, setSelections] = useState<Record<number, Set<string>>>(() => {
    const init: Record<number, Set<string>> = {};
    for (let i = 0; i < questions.length; i++) init[i] = new Set();
    return init;
  });
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (let i = 0; i < questions.length; i++) init[i] = "";
    return init;
  });

  const toggleOption = useCallback((idx: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[idx]);
      if (label === OTHER_KEY) {
        if (current.has(OTHER_KEY)) current.delete(OTHER_KEY);
        else { if (!multiSelect) current.clear(); current.add(OTHER_KEY); }
      } else if (multiSelect) {
        current.delete(OTHER_KEY);
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [idx]: current };
    });
  }, []);

  const allAnswered = questions.every((q, i) => {
    const sel = selections[i];
    if (sel.size === 0) return false;
    if (sel.has(OTHER_KEY) && !otherTexts[i].trim()) return false;
    return true;
  });

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections[i];
      if (sel.has(OTHER_KEY)) {
        answers[q.question] = otherTexts[i].trim();
      } else {
        answers[q.question] = Array.from(sel).join(", ");
      }
    }
    onApprove(toolUseId, answers);
  };

  return (
    <div className="p-4 mx-4 my-2 bg-card border border-border shadow-lg rounded-xl">
      {questions.map((q, i) => (
        <div key={i} className={cn("mb-4", i === questions.length - 1 && "mb-3")}>
          {q.header && (
            <div className="text-[0.6875rem] font-bold uppercase tracking-widest text-primary mb-1">{q.header}</div>
          )}
          <div className="text-[0.9375rem] text-foreground mb-2.5 leading-snug">{q.question}</div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((opt, optIdx) => {
              const selected = selections[i].has(opt.label);
              return (
                <button
                  key={optIdx}
                  className={cn(
                    "flex flex-col gap-0.5 px-3 py-2 rounded-lg border bg-input text-foreground cursor-pointer text-left transition-colors duration-150",
                    selected ? "border-primary bg-primary/12" : "border-border hover:border-primary"
                  )}
                  onClick={() => toggleOption(i, opt.label, q.multiSelect)}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  {opt.description && <span className="text-xs text-muted-foreground leading-tight">{opt.description}</span>}
                </button>
              );
            })}
            <button
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2 rounded-lg border bg-input text-foreground cursor-pointer text-left transition-colors duration-150",
                selections[i].has(OTHER_KEY) ? "border-primary bg-primary/12" : "border-border hover:border-primary"
              )}
              onClick={() => toggleOption(i, OTHER_KEY, q.multiSelect)}
            >
              <span className="text-sm font-semibold">Other</span>
            </button>
          </div>
          {selections[i].has(OTHER_KEY) && (
            <textarea
              className="w-full mt-1.5 px-2 py-2 rounded-lg border border-border bg-input text-foreground text-sm font-[inherit] resize-y outline-none focus:border-ring"
              placeholder="Type your answer..."
              value={otherTexts[i]}
              onChange={(e) => setOtherTexts((prev) => ({ ...prev, [i]: e.target.value }))}
              rows={2}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!allAnswered} className="h-10 bg-emerald-500 text-black hover:bg-emerald-400">Submit</Button>
        <Button size="sm" variant="destructive" onClick={() => onDeny(toolUseId)} className="h-10">Dismiss</Button>
      </div>
    </div>
  );
}

function SwipeableToolApproval({ toolName, toolUseId, input, onApprove, onApproveAlways, onDeny }: Props) {
  const [offsetX, setOffsetX] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const swipe = useSwipe({
    threshold: 80,
    onSwipeRight: () => { setOffsetX(0); onApprove(toolUseId); },
    onSwipeLeft: () => { setOffsetX(0); onDeny(toolUseId); },
    onProgress: (dx) => setOffsetX(dx),
    onCancel: () => setOffsetX(0),
  });

  const approveVisible = offsetX > 10;
  const denyVisible = offsetX < -10;
  const opacity = Math.min(Math.abs(offsetX) / 80, 1);

  return (
    <div className="relative mx-4 my-2 overflow-hidden rounded-xl">
      {/* Green approve hint */}
      <div
        className="absolute inset-0 rounded-xl bg-emerald-500/30 flex items-center pl-4"
        style={{ opacity: approveVisible ? opacity : 0 }}
        aria-hidden
      >
        <span className="text-emerald-400 font-semibold text-sm">Approve</span>
      </div>
      {/* Red deny hint */}
      <div
        className="absolute inset-0 rounded-xl bg-destructive/30 flex items-center justify-end pr-4"
        style={{ opacity: denyVisible ? opacity : 0 }}
        aria-hidden
      >
        <span className="text-destructive font-semibold text-sm">Deny</span>
      </div>
      <div
        ref={cardRef}
        {...swipe}
        style={{ transform: `translateX(${offsetX}px)`, transition: offsetX === 0 ? "transform 0.2s ease" : "none" }}
        className="bg-card border border-border shadow-lg rounded-xl p-4 touch-pan-y"
      >
        <div className="font-semibold text-amber-400 mb-2 flex items-center gap-2"><Shield className="size-4" />Tool: {toolName}</div>
        <ToolInputDisplay toolName={toolName} input={input} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onApprove(toolUseId)} className="h-10 bg-emerald-500 text-black hover:bg-emerald-400">Approve</Button>
          <Button size="sm" onClick={() => onApproveAlways(toolUseId)} className="h-10 bg-amber-400 text-black hover:bg-amber-300">Always Allow</Button>
          <Button size="sm" variant="destructive" onClick={() => onDeny(toolUseId)} className="h-10">Deny</Button>
        </div>
      </div>
    </div>
  );
}

export interface PlanTransitionCardProps {
  toolUseId: string;
  planContent: string | null;
  onApprove: (toolUseId: string, opts: { targetMode: string; clearContext: boolean; answers?: Record<string, string> }) => void;
  onDeny: (toolUseId: string, message?: string) => void;
}

export function PlanTransitionCard({ toolUseId, planContent, onApprove, onDeny }: PlanTransitionCardProps) {
  const [selectedMode, setSelectedMode] = useState<"acceptEdits" | "default" | null>(null);
  const [clearContext, setClearContext] = useState(false);
  const [keepPlanningText, setKeepPlanningText] = useState("");
  const [isKeepPlanning, setIsKeepPlanning] = useState(false);

  const canProceed = selectedMode !== null;
  const canKeepPlanning = keepPlanningText.trim().length > 0;

  return (
    <div className="mx-4 my-2 bg-card border border-blue-500/40 shadow-lg rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="font-semibold text-blue-400 mb-1 flex items-center gap-2">
          <span>📋</span>
          <span>Plan Ready</span>
        </div>
        <p className="text-xs text-muted-foreground">Claude has finished planning. Choose how to proceed.</p>
      </div>

      {/* Plan content — scrollable if present */}
      {planContent !== null && (
        <div className="px-4 py-3 border-b border-border max-h-48 overflow-y-auto">
          <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{planContent}</pre>
        </div>
      )}

      {/* Implementation mode selection */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How to implement:</p>
        {[
          { value: "acceptEdits" as const, label: "Auto-accept edits", description: "File changes applied automatically; Bash commands still need approval" },
          { value: "default" as const, label: "Approve each change", description: "Review and approve every file edit and command" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSelectedMode(opt.value)}
            className={cn(
              "w-full flex flex-col gap-0.5 px-3 py-2 rounded-lg border text-left transition-colors",
              selectedMode === opt.value
                ? "border-blue-500/60 bg-blue-500/10 text-foreground"
                : "border-border bg-input text-muted-foreground hover:border-blue-500/40 hover:text-foreground"
            )}
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-xs opacity-70">{opt.description}</span>
          </button>
        ))}

        {/* Clear context checkbox */}
        <label className="flex items-center gap-2 px-1 pt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={clearContext}
            onChange={(e) => setClearContext(e.target.checked)}
            className="rounded accent-blue-500"
          />
          <span className="text-xs text-muted-foreground">Also clear context (start a fresh session)</span>
        </label>
      </div>

      {/* Keep planning section */}
      <div className="px-4 py-3 space-y-2">
        <button
          onClick={() => setIsKeepPlanning(!isKeepPlanning)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {isKeepPlanning ? "▲ Cancel — I want to proceed" : "▼ Keep planning instead"}
        </button>
        {isKeepPlanning && (
          <textarea
            value={keepPlanningText}
            onChange={(e) => setKeepPlanningText(e.target.value)}
            placeholder="Tell Claude what to focus on or reconsider..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-input text-foreground text-sm font-[inherit] resize-none outline-none focus:border-ring placeholder:text-muted-foreground"
            rows={2}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 flex gap-2">
        {!isKeepPlanning ? (
          <Button
            size="sm"
            onClick={() => canProceed && onApprove(toolUseId, { targetMode: selectedMode!, clearContext })}
            disabled={!canProceed}
            className="h-10 bg-blue-600 hover:bg-blue-500 text-white"
          >
            Proceed
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => canKeepPlanning && onDeny(toolUseId, keepPlanningText.trim())}
            disabled={!canKeepPlanning}
            className="h-10"
            variant="outline"
          >
            Keep Planning
          </Button>
        )}
      </div>
    </div>
  );
}

export function ToolApproval({ toolName, toolUseId, input, onApprove, onApproveAlways, onDeny }: Props) {
  const isDesktop = useIsDesktop();

  if (toolName === "AskUserQuestion" && isAskUserQuestion(input)) {
    return <AskUserQuestionUI questions={input.questions} toolUseId={toolUseId} onApprove={onApprove} onDeny={onDeny} />;
  }

  if (!isDesktop) {
    return (
      <SwipeableToolApproval
        toolName={toolName} toolUseId={toolUseId} input={input}
        onApprove={onApprove} onApproveAlways={onApproveAlways} onDeny={onDeny}
      />
    );
  }

  return (
    <div className="p-4 mx-4 my-2 bg-card border border-border shadow-lg rounded-xl">
      <div className="font-semibold text-amber-400 mb-2 flex items-center gap-2"><Shield className="size-4" />Tool: {toolName}</div>
      <ToolInputDisplay toolName={toolName} input={input} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onApprove(toolUseId)} className="h-10 bg-emerald-500 text-black hover:bg-emerald-400">Approve</Button>
        <Button size="sm" onClick={() => onApproveAlways(toolUseId)} className="h-10 bg-amber-400 text-black hover:bg-amber-300">Always Allow</Button>
        <Button size="sm" variant="destructive" onClick={() => onDeny(toolUseId)} className="h-10">Deny</Button>
      </div>
    </div>
  );
}

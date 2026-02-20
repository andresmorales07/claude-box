import { useState } from "react";

interface Props {
  toolName: string; toolUseId: string; input: unknown;
  onApprove: (toolUseId: string, answers?: Record<string, string>) => void;
  onDeny: (toolUseId: string) => void;
}

interface QuestionOption {
  label: string;
  description: string;
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
      return typeof qObj.question === "string" && Array.isArray(qObj.options);
    });
}

function AskUserQuestionUI({ questions, toolUseId, onApprove, onDeny }: {
  questions: Question[]; toolUseId: string;
  onApprove: Props["onApprove"]; onDeny: Props["onDeny"];
}) {
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const q of questions) init[q.question] = new Set();
    return init;
  });
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) init[q.question] = "";
    return init;
  });

  const toggleOption = (question: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[question]);
      if (label === "__other__") {
        if (current.has("__other__")) current.delete("__other__");
        else { if (!multiSelect) current.clear(); current.add("__other__"); }
      } else if (multiSelect) {
        current.delete("__other__");
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [question]: current };
    });
  };

  const allAnswered = questions.every((q) => {
    const sel = selections[q.question];
    if (sel.size === 0) return false;
    if (sel.has("__other__") && !otherTexts[q.question].trim()) return false;
    return true;
  });

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const sel = selections[q.question];
      if (sel.has("__other__")) {
        answers[q.question] = otherTexts[q.question].trim();
      } else {
        answers[q.question] = Array.from(sel).join(", ");
      }
    }
    onApprove(toolUseId, answers);
  };

  return (
    <div className="tool-approval ask-user-question">
      {questions.map((q) => (
        <div key={q.question} className="auq-question">
          {q.header && <div className="auq-header">{q.header}</div>}
          <div className="auq-text">{q.question}</div>
          <div className="auq-options">
            {q.options.map((opt) => {
              const selected = selections[q.question].has(opt.label);
              return (
                <button
                  key={opt.label}
                  className={`auq-option${selected ? " selected" : ""}`}
                  onClick={() => toggleOption(q.question, opt.label, q.multiSelect)}
                >
                  <span className="auq-option-label">{opt.label}</span>
                  {opt.description && <span className="auq-option-desc">{opt.description}</span>}
                </button>
              );
            })}
            <button
              className={`auq-option auq-option-other${selections[q.question].has("__other__") ? " selected" : ""}`}
              onClick={() => toggleOption(q.question, "__other__", q.multiSelect)}
            >
              <span className="auq-option-label">Other</span>
            </button>
          </div>
          {selections[q.question].has("__other__") && (
            <textarea
              className="auq-other-input"
              placeholder="Type your answer..."
              value={otherTexts[q.question]}
              onChange={(e) => setOtherTexts((prev) => ({ ...prev, [q.question]: e.target.value }))}
              rows={2}
            />
          )}
        </div>
      ))}
      <div className="actions">
        <button className="approve" onClick={handleSubmit} disabled={!allAnswered}>Submit</button>
        <button className="deny" onClick={() => onDeny(toolUseId)}>Dismiss</button>
      </div>
    </div>
  );
}

export function ToolApproval({ toolName, toolUseId, input, onApprove, onDeny }: Props) {
  if (toolName === "AskUserQuestion" && isAskUserQuestion(input)) {
    return <AskUserQuestionUI questions={input.questions} toolUseId={toolUseId} onApprove={onApprove} onDeny={onDeny} />;
  }

  return (
    <div className="tool-approval">
      <div className="tool-name">Tool: {toolName}</div>
      <div className="tool-input">{JSON.stringify(input, null, 2)}</div>
      <div className="actions">
        <button className="approve" onClick={() => onApprove(toolUseId)}>Approve</button>
        <button className="deny" onClick={() => onDeny(toolUseId)}>Deny</button>
      </div>
    </div>
  );
}

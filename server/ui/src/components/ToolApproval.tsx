import { useState, useCallback } from "react";

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
    <div className="tool-approval ask-user-question">
      {questions.map((q, i) => (
        <div key={i} className="auq-question">
          {q.header && <div className="auq-header">{q.header}</div>}
          <div className="auq-text">{q.question}</div>
          <div className="auq-options">
            {q.options.map((opt, optIdx) => {
              const selected = selections[i].has(opt.label);
              return (
                <button
                  key={optIdx}
                  className={`auq-option${selected ? " selected" : ""}`}
                  onClick={() => toggleOption(i, opt.label, q.multiSelect)}
                >
                  <span className="auq-option-label">{opt.label}</span>
                  {opt.description && <span className="auq-option-desc">{opt.description}</span>}
                </button>
              );
            })}
            <button
              className={`auq-option auq-option-other${selections[i].has(OTHER_KEY) ? " selected" : ""}`}
              onClick={() => toggleOption(i, OTHER_KEY, q.multiSelect)}
            >
              <span className="auq-option-label">Other</span>
            </button>
          </div>
          {selections[i].has(OTHER_KEY) && (
            <textarea
              className="auq-other-input"
              placeholder="Type your answer..."
              value={otherTexts[i]}
              onChange={(e) => setOtherTexts((prev) => ({ ...prev, [i]: e.target.value }))}
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

export function ToolApproval({ toolName, toolUseId, input, onApprove, onApproveAlways, onDeny }: Props) {
  if (toolName === "AskUserQuestion" && isAskUserQuestion(input)) {
    return <AskUserQuestionUI questions={input.questions} toolUseId={toolUseId} onApprove={onApprove} onDeny={onDeny} />;
  }

  return (
    <div className="tool-approval">
      <div className="tool-name">Tool: {toolName}</div>
      <div className="tool-input">{JSON.stringify(input, null, 2)}</div>
      <div className="actions">
        <button className="approve" onClick={() => onApprove(toolUseId)}>Approve</button>
        <button className="approve-always" onClick={() => onApproveAlways(toolUseId)}>Always Allow</button>
        <button className="deny" onClick={() => onDeny(toolUseId)}>Deny</button>
      </div>
    </div>
  );
}

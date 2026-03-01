import type { ToolUsePart } from "@shared/types";

// Tools rendered by special-purpose components — excluded from generic grouping.
export function isGenericToolUse(part: ToolUsePart): boolean {
  if (["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"].includes(part.toolName)) return false;
  if (part.toolName === "Task") return false;
  if (part.toolName === "Write" || part.toolName === "Edit") return false;
  return true;
}

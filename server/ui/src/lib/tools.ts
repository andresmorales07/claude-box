/** Extract a human-readable one-liner from tool input based on tool name. */
export function getToolSummary(toolName: string, input: unknown): string {
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

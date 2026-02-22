import { describe, it, expect } from "vitest";
import { getToolSummary } from "../ui/src/lib/tools";

describe("getToolSummary", () => {
  describe("file path tools (Read, Write, Edit, NotebookEdit)", () => {
    it("returns file_path for Read", () => {
      expect(getToolSummary("Read", { file_path: "/src/index.ts" })).toBe("/src/index.ts");
    });

    it("returns file_path for Write", () => {
      expect(getToolSummary("Write", { file_path: "/tmp/out.txt", content: "hello" })).toBe("/tmp/out.txt");
    });

    it("returns file_path for Edit", () => {
      expect(getToolSummary("Edit", { file_path: "/src/app.ts", old_string: "a", new_string: "b" })).toBe("/src/app.ts");
    });

    it("returns file_path for NotebookEdit", () => {
      expect(getToolSummary("NotebookEdit", { file_path: "/nb.ipynb", new_source: "x" })).toBe("/nb.ipynb");
    });

    it("matches tool names containing the substring", () => {
      expect(getToolSummary("mcp__fs__Read", { file_path: "/foo" })).toBe("/foo");
    });
  });

  describe("Bash", () => {
    it("returns the command", () => {
      expect(getToolSummary("Bash", { command: "ls -la" })).toBe("ls -la");
    });

    it("truncates commands longer than 80 chars", () => {
      const long = "x".repeat(100);
      const result = getToolSummary("Bash", { command: long });
      expect(result).toBe("x".repeat(77) + "...");
      expect(result.length).toBe(80);
    });

    it("does not truncate commands exactly 80 chars", () => {
      const exact = "y".repeat(80);
      expect(getToolSummary("Bash", { command: exact })).toBe(exact);
    });
  });

  describe("Glob and Grep", () => {
    it("returns pattern for Glob", () => {
      expect(getToolSummary("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    });

    it("returns pattern for Grep", () => {
      expect(getToolSummary("Grep", { pattern: "TODO|FIXME" })).toBe("TODO|FIXME");
    });
  });

  describe("WebFetch", () => {
    it("returns the url", () => {
      expect(getToolSummary("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
    });
  });

  describe("Task", () => {
    it("returns the description", () => {
      expect(getToolSummary("Task", { description: "Explore codebase" })).toBe("Explore codebase");
    });
  });

  describe("WebSearch", () => {
    it("returns the query", () => {
      expect(getToolSummary("WebSearch", { query: "react hooks" })).toBe("react hooks");
    });
  });

  describe("fallback behavior", () => {
    it("returns first string value for unknown tools", () => {
      expect(getToolSummary("CustomTool", { foo: 42, bar: "hello" })).toBe("hello");
    });

    it("truncates long fallback values", () => {
      const long = "z".repeat(100);
      const result = getToolSummary("CustomTool", { val: long });
      expect(result).toBe("z".repeat(77) + "...");
    });

    it("skips empty string values in fallback", () => {
      expect(getToolSummary("CustomTool", { empty: "", real: "found" })).toBe("found");
    });

    it("returns empty string when no string values exist", () => {
      expect(getToolSummary("CustomTool", { num: 42, flag: true })).toBe("");
    });

    it("returns empty string for empty object", () => {
      expect(getToolSummary("CustomTool", {})).toBe("");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for null input", () => {
      expect(getToolSummary("Read", null)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(getToolSummary("Read", undefined)).toBe("");
    });

    it("returns empty string for non-object input", () => {
      expect(getToolSummary("Read", "string")).toBe("");
      expect(getToolSummary("Read", 42)).toBe("");
    });
  });
});

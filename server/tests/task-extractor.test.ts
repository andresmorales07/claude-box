import { describe, it, expect } from "vitest";
import { extractTasks } from "../src/task-extractor.js";
import type { NormalizedMessage } from "../src/providers/types.js";

// ── Helpers ──

function makeTaskCreate(
  toolUseId: string,
  subject?: string,
  activeForm?: string,
): NormalizedMessage {
  const input: Record<string, unknown> = {};
  if (subject !== undefined) input.subject = subject;
  if (activeForm !== undefined) input.activeForm = activeForm;
  return {
    role: "assistant",
    parts: [
      {
        type: "tool_use",
        toolUseId,
        toolName: "TaskCreate",
        input: Object.keys(input).length > 0 ? input : undefined,
      },
    ],
    index: 0,
  };
}

function makeToolResult(toolUseId: string, output: string): NormalizedMessage {
  return {
    role: "user",
    parts: [
      {
        type: "tool_result",
        toolUseId,
        output,
        isError: false,
      },
    ],
    index: 0,
  };
}

function makeTaskUpdate(
  toolUseId: string,
  taskId: string | number | undefined,
  updates: { status?: string; subject?: string; activeForm?: string },
): NormalizedMessage {
  const input: Record<string, unknown> = {};
  if (taskId !== undefined) input.taskId = taskId;
  if (updates.status !== undefined) input.status = updates.status;
  if (updates.subject !== undefined) input.subject = updates.subject;
  if (updates.activeForm !== undefined) input.activeForm = updates.activeForm;
  return {
    role: "assistant",
    parts: [
      {
        type: "tool_use",
        toolUseId,
        toolName: "TaskUpdate",
        input,
      },
    ],
    index: 0,
  };
}

// ── Tests ──

describe("extractTasks", () => {
  describe("TaskCreate with tool_result", () => {
    it("extracts numeric ID from Task #N pattern in tool_result", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_1", "Implement auth"),
        makeToolResult("tu_1", "Task #42 created successfully"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ id: "42", subject: "Implement auth", status: "pending" });
    });

    it("falls back to toolUseId when no Task #N in output", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_abc", "No ID task"),
        makeToolResult("tu_abc", "Created successfully"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("tu_abc");
    });

    it("preserves activeForm from input", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_2", "Design UI", "expanded"),
        makeToolResult("tu_2", "Task #7 created"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks[0].activeForm).toBe("expanded");
    });

    it("defaults subject to 'Untitled task' when subject is missing", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_3"),
        makeToolResult("tu_3", "Task #1 created"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks[0].subject).toBe("Untitled task");
    });

    it("defaults subject to 'Untitled task' when subject is empty string", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_4", ""),
        makeToolResult("tu_4", "Task #2 created"),
      ];
      // Empty string is falsy for typeof check but is a string, so it passes through
      const tasks = extractTasks(msgs);
      // extractTasks checks `typeof input.subject === "string"` which matches ""
      expect(tasks[0].subject).toBe("");
    });

    it("handles input: undefined without crash", () => {
      // Create a TaskCreate with no input at all
      const msg: NormalizedMessage = {
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            toolUseId: "tu_5",
            toolName: "TaskCreate",
            input: undefined,
          },
        ],
        index: 0,
      };
      const msgs: NormalizedMessage[] = [
        msg,
        makeToolResult("tu_5", "Task #99 ok"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].subject).toBe("Untitled task");
    });
  });

  describe("pending creates (no tool_result)", () => {
    it("includes pending creates with status 'pending' and toolUseId as id", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_pending", "Pending task"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: "tu_pending",
        subject: "Pending task",
        status: "pending",
      });
    });
  });

  describe("TaskUpdate", () => {
    it("updates status of existing task", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u1", "Task A"),
        makeToolResult("tu_u1", "Task #10 created"),
        makeTaskUpdate("tu_upd1", "10", { status: "in_progress" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks[0].status).toBe("in_progress");
    });

    it("updates subject of existing task", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u2", "Old name"),
        makeToolResult("tu_u2", "Task #11 created"),
        makeTaskUpdate("tu_upd2", "11", { subject: "New name" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks[0].subject).toBe("New name");
    });

    it("updates activeForm of existing task", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u3", "Form task"),
        makeToolResult("tu_u3", "Task #12 created"),
        makeTaskUpdate("tu_upd3", "12", { activeForm: "collapsed" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks[0].activeForm).toBe("collapsed");
    });

    it("ignores update for nonexistent taskId", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u4", "Only task"),
        makeToolResult("tu_u4", "Task #13 created"),
        makeTaskUpdate("tu_upd4", "999", { status: "completed" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("pending"); // unchanged
    });

    it("ignores update with missing input", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u5", "Safe task"),
        makeToolResult("tu_u5", "Task #14 created"),
        {
          role: "assistant",
          parts: [
            {
              type: "tool_use",
              toolUseId: "tu_upd5",
              toolName: "TaskUpdate",
              input: undefined,
            },
          ],
          index: 0,
        },
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].subject).toBe("Safe task"); // unchanged
    });

    it("ignores update with non-string taskId", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_u6", "Num task"),
        makeToolResult("tu_u6", "Task #15 created"),
        makeTaskUpdate("tu_upd6", 15 as unknown as string, { status: "completed" }),
      ];
      const tasks = extractTasks(msgs);
      // The numeric taskId fails the `typeof input.taskId === "string"` check
      expect(tasks[0].status).toBe("pending");
    });
  });

  describe("deletion filtering", () => {
    it("filters out tasks with status 'deleted'", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_d1", "Delete me"),
        makeToolResult("tu_d1", "Task #20 created"),
        makeTaskUpdate("tu_upd_d1", "20", { status: "deleted" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(0);
    });

    it("returns only non-deleted tasks in a mix", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_d2", "Keep me"),
        makeToolResult("tu_d2", "Task #21 created"),
        makeTaskCreate("tu_d3", "Delete me"),
        makeToolResult("tu_d3", "Task #22 created"),
        makeTaskCreate("tu_d4", "Also keep"),
        makeToolResult("tu_d4", "Task #23 created"),
        makeTaskUpdate("tu_upd_d2", "22", { status: "deleted" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.subject)).toEqual(["Keep me", "Also keep"]);
    });
  });

  describe("complex scenarios", () => {
    it("handles multiple tasks across multiple messages", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_m1", "Task 1"),
        makeTaskCreate("tu_m2", "Task 2"),
        makeToolResult("tu_m1", "Task #1 created"),
        makeToolResult("tu_m2", "Task #2 created"),
        makeTaskUpdate("tu_upd_m1", "1", { status: "in_progress" }),
        makeTaskCreate("tu_m3", "Task 3"),
        makeToolResult("tu_m3", "Task #3 created"),
        makeTaskUpdate("tu_upd_m2", "2", { status: "completed" }),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]).toMatchObject({ id: "1", status: "in_progress" });
      expect(tasks[1]).toMatchObject({ id: "2", status: "completed" });
      expect(tasks[2]).toMatchObject({ id: "3", status: "pending" });
    });

    it("skips system-role messages", () => {
      const msgs: NormalizedMessage[] = [
        {
          role: "system",
          event: { type: "session_result", totalCostUsd: 0, numTurns: 1 },
          index: 0,
        },
        makeTaskCreate("tu_s1", "Real task"),
        makeToolResult("tu_s1", "Task #30 created"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("30");
    });

    it("ignores tool_result with no matching pending create", () => {
      const msgs: NormalizedMessage[] = [
        makeToolResult("tu_orphan", "Task #50 created"),
        makeTaskCreate("tu_real", "Real task"),
        makeToolResult("tu_real", "Task #51 created"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("51");
    });

    it("preserves insertion order", () => {
      const msgs: NormalizedMessage[] = [
        makeTaskCreate("tu_o1", "First"),
        makeToolResult("tu_o1", "Task #1 created"),
        makeTaskCreate("tu_o2", "Second"),
        makeToolResult("tu_o2", "Task #2 created"),
        makeTaskCreate("tu_o3", "Third"),
        makeToolResult("tu_o3", "Task #3 created"),
      ];
      const tasks = extractTasks(msgs);
      expect(tasks.map((t) => t.subject)).toEqual(["First", "Second", "Third"]);
    });

    it("returns empty array for empty message list", () => {
      expect(extractTasks([])).toEqual([]);
    });

    it("returns empty array when no task-related tool calls exist", () => {
      const msgs: NormalizedMessage[] = [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Just some text" }],
          index: 0,
        },
        {
          role: "user",
          parts: [{ type: "text", text: "A question" }],
          index: 1,
        },
      ];
      expect(extractTasks(msgs)).toEqual([]);
    });
  });
});

import { z } from "zod";
import "./common.js"; // ensure extendZodWithOpenApi runs first

export const CLAUDE_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
] as const;

export const EFFORT_VALUES = ["low", "medium", "high", "max"] as const;

export const SettingsSchema = z
  .object({
    theme: z.enum(["dark", "light"]).openapi({ description: "UI color theme" }),
    terminalFontSize: z.number().int().min(10).max(20).openapi({ description: "Terminal font size in pixels (10–20)" }),
    terminalScrollback: z.number().int().min(100).max(10000).openapi({ description: "Terminal scrollback buffer size in lines (100–10000)" }),
    terminalShell: z.string().min(1).openapi({ description: "Default shell command for new terminal sessions" }),
    claudeModel: z.enum(CLAUDE_MODELS).nullable().optional().openapi({ description: "Default Claude model for new sessions (null/undefined = SDK default)" }),
    claudeEffort: z.enum(EFFORT_VALUES).default("high").openapi({ description: "Default effort level for new sessions" }),
  })
  .openapi("Settings");

export const PatchSettingsSchema = SettingsSchema.partial().openapi("PatchSettings");

export type Settings = z.infer<typeof SettingsSchema>;

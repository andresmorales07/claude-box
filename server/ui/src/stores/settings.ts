import { create } from "zustand";
import { useAuthStore } from "./auth";

type ClaudeModel = "claude-haiku-4-5-20251001" | "claude-sonnet-4-6" | "claude-opus-4-6";
type ClaudeEffort = "low" | "medium" | "high" | "max";

export interface SettingsState {
  theme: "dark" | "light";
  terminalFontSize: number;
  terminalScrollback: number;
  terminalShell: string;
  claudeModel: ClaudeModel | undefined;
  claudeEffort: ClaudeEffort;

  fetchSettings: () => Promise<void>;
  updateSettings: (partial: Partial<Omit<SettingsState, "fetchSettings" | "updateSettings">>) => Promise<void>;
}

// NOTE: These lists must match server/src/schemas/settings.ts CLAUDE_MODELS and EFFORT_VALUES.
// The UI bundle cannot import from the server schema directly (different package), so this
// is a documented exception to the Zod-as-single-source-of-truth convention.
const CLAUDE_MODELS: ClaudeModel[] = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"];
const CLAUDE_EFFORTS: ClaudeEffort[] = ["low", "medium", "high", "max"];

const DEFAULTS = {
  theme: "dark" as const,
  terminalFontSize: 14,
  terminalScrollback: 1000,
  terminalShell: "/bin/bash",
  claudeModel: undefined as ClaudeModel | undefined,
  claudeEffort: "high" as ClaudeEffort,
};

function applyTheme(theme: "dark" | "light"): void {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULTS,

  fetchSettings: async () => {
    const token = useAuthStore.getState().token;
    try {
      const res = await fetch("/api/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as Partial<SettingsState>;
      const theme = (data.theme === "light" ? "light" : "dark") as "dark" | "light";
      set({
        theme,
        terminalFontSize: data.terminalFontSize ?? DEFAULTS.terminalFontSize,
        terminalScrollback: data.terminalScrollback ?? DEFAULTS.terminalScrollback,
        terminalShell: data.terminalShell ?? DEFAULTS.terminalShell,
        claudeModel: CLAUDE_MODELS.includes(data.claudeModel as ClaudeModel)
          ? (data.claudeModel as ClaudeModel)
          : undefined,
        claudeEffort: CLAUDE_EFFORTS.includes(data.claudeEffort as ClaudeEffort)
          ? (data.claudeEffort as ClaudeEffort)
          : "high",
      });
      applyTheme(theme);
    } catch {
      // Network error — silently use defaults
    }
  },

  updateSettings: async (partial) => {
    // Optimistic update
    set(partial);
    if (partial.theme !== undefined) applyTheme(partial.theme);

    const token = useAuthStore.getState().token;
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(partial),
      });
    } catch {
      // Server-side failure — the optimistic update stays in place
    }
  },
}));

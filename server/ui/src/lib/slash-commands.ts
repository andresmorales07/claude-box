import type { SlashCommand } from "@shared/types";

export function getFilteredCommands(commands: SlashCommand[], input: string): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const filter = input.slice(1);
  if (filter.includes(" ")) return [];
  return commands.filter((cmd) =>
    typeof cmd.name === "string" && cmd.name.toLowerCase().startsWith(filter.toLowerCase()),
  );
}

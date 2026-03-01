/** Map a model ID to a short display label.
 *  Priority: explicit display name > derived from ID pattern > SDK alias > raw ID. */
export function modelLabel(id: string, name?: string): string {
  if (name) return name;
  // Full model IDs: "claude-opus-4-6-20250514" → "Opus 4.6"
  const match = id.match(/claude-(\w+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8,})?$/);
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    return match[3] ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`;
  }
  // SDK aliases: "sonnet" → "Sonnet", "opus[1m]" → "Opus (1M)", "default" → "Default"
  const aliasMatch = id.match(/^(\w+?)(?:\[(\w+)])?$/);
  if (aliasMatch) {
    const family = aliasMatch[1].charAt(0).toUpperCase() + aliasMatch[1].slice(1);
    return aliasMatch[2] ? `${family} (${aliasMatch[2].toUpperCase()})` : family;
  }
  return id;
}

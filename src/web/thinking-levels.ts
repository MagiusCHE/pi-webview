// Thinking levels of the active model (pi core `get_available_thinking_levels`):
// ordered from the lowest to the highest. When the model changes, a level not
// supported by the new model must be clamped instead of being kept in the UI.

/** Highest level supported by a model, or the requested one when valid. */
export function clampThinkingLevel(level: string, levels: readonly string[]): string {
  if (levels.includes(level)) return level;
  return levels.length > 0 ? (levels[levels.length - 1] ?? "") : "";
}

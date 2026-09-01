import type { StatsBarPosition } from "../ide/protocol.ts";

export function normalizeHiddenStatusKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (key): key is string => typeof key === "string" && key.trim().length > 0,
      ),
    ),
  ];
}

export function setStatusKeyHidden(
  hiddenKeys: readonly string[],
  key: string,
  hidden: boolean,
): string[] {
  const normalized = normalizeHiddenStatusKeys(hiddenKeys);
  if (!key.trim()) return normalized;
  if (hidden) return normalized.includes(key) ? normalized : [...normalized, key];
  return normalized.filter((candidate) => candidate !== key);
}

/** Preserve the old placement-dependent behavior until the user explicitly
 * saves the new independent compact preference. */
export function effectiveStatsBarCompact(
  configured: unknown,
  position: StatsBarPosition,
): boolean {
  return typeof configured === "boolean" ? configured : position !== "topbar";
}

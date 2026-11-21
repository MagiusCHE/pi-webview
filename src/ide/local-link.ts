const DRIVE_PATH = /^[a-z]:[/\\]/i;
const UNSAFE_PATH = /^(?:[/\\]{2}|\\)|[\x00-\x1f\x7f]/;

/** A filesystem path, not a URI, network share, Windows device or alternate stream. */
export function isLocalLinkPath(path: unknown): path is string {
  if (typeof path !== "string" || !path.trim() || UNSAFE_PATH.test(path)) return false;
  return !(DRIVE_PATH.test(path) ? path.slice(2) : path).includes(":");
}

/** Interprets Markdown relative destinations as relative to the session workspace. */
export function localLinkPath(href: string): string | undefined {
  const value = href.trim();
  if (/^[?#]/.test(value) || UNSAFE_PATH.test(value)) return undefined;
  let path = value.split(/[?#]/, 1)[0]!;
  if (!DRIVE_PATH.test(path) && /^[a-z][a-z\d+.-]*:/i.test(path)) {
    if (!/^file:\/\//i.test(path)) return undefined;
    try {
      const url = new URL(path);
      if (url.host) return undefined;
      path = url.pathname.replace(/^\/(?=[a-z]:\/)/i, "");
    } catch {
      return undefined;
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // A literal percent sign in a Markdown path is also valid.
  }
  return isLocalLinkPath(path) ? path : undefined;
}

export const DEFAULT_LINK_TOOLTIP_MAX_CHARS = 50;

export function normalizeLinkTooltipMaxChars(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_LINK_TOOLTIP_MAX_CHARS;
}

export function linkTooltip(destination: string, maxChars: number): string {
  if (destination.length <= maxChars) return destination;
  let offset = 0;
  let count = 0;
  for (const character of destination) {
    if (count++ >= maxChars) break;
    offset += character.length;
  }
  return destination.slice(0, offset);
}

import type { SelectionRange } from "../../ide/protocol.ts";

export const LAST_EDITOR_SELECTION_KEY = "pi-webview.lastEditorSelection";

export interface PersistedEditorSelection {
  filePath?: string;
  workspaceFolder?: string;
  ranges: SelectionRange[];
}

function point(value: unknown): { line: number; character: number } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { line?: unknown; character?: unknown };
  if (
    !Number.isInteger(candidate.line) ||
    !Number.isInteger(candidate.character) ||
    Number(candidate.line) < 0 ||
    Number(candidate.character) < 0
  ) {
    return null;
  }
  return { line: Number(candidate.line), character: Number(candidate.character) };
}

/** Validate workspaceState before restoring selection text after a window reload. */
export function normalizePersistedEditorSelection(
  value: unknown,
): PersistedEditorSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    filePath?: unknown;
    workspaceFolder?: unknown;
    ranges?: unknown;
  };
  if (!Array.isArray(candidate.ranges)) return null;
  const ranges: SelectionRange[] = [];
  for (const range of candidate.ranges) {
    if (!range || typeof range !== "object") return null;
    const item = range as { text?: unknown; selection?: unknown };
    if (
      typeof item.text !== "string" ||
      !item.selection ||
      typeof item.selection !== "object"
    ) {
      return null;
    }
    const selection = item.selection as { start?: unknown; end?: unknown };
    const start = point(selection.start);
    const end = point(selection.end);
    if (!start || !end) return null;
    ranges.push({ text: item.text, selection: { start, end } });
  }
  if (ranges.length === 0) return null;
  return {
    ...(typeof candidate.filePath === "string" ? { filePath: candidate.filePath } : {}),
    ...(typeof candidate.workspaceFolder === "string"
      ? { workspaceFolder: candidate.workspaceFolder }
      : {}),
    ranges,
  };
}

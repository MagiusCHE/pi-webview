import type { SelectionRange } from "../ide/protocol.ts";

const START = "<pi-webview-editor-selection>";
const END = "</pi-webview-editor-selection>";

export interface ActiveEditorSelection {
  filePath?: string;
  workspaceFolder?: string;
  ranges: SelectionRange[];
}

/**
 * Appends the active editor selection to the text sent to pi. The JSON payload
 * preserves the selected text exactly; line and column numbers are converted
 * from the IDE's zero-based coordinates to one-based coordinates for the
 * model. This block is transport context and is stripped from chat rendering.
 */
export function attachEditorSelectionContext(
  message: string,
  selection: ActiveEditorSelection | null,
): string {
  if (!selection || selection.ranges.length === 0) return message;

  const payload = {
    filePath: selection.filePath,
    workspaceFolder: selection.workspaceFolder,
    ranges: selection.ranges.map((range) => ({
      start: {
        line: range.selection.start.line + 1,
        column: range.selection.start.character + 1,
      },
      end: {
        line: range.selection.end.line + 1,
        column: range.selection.end.character + 1,
      },
      text: range.text,
    })),
  };
  const context = [
    START,
    "The following exact text is currently selected in the user's IDE. Treat it as context for the request:",
    JSON.stringify(payload, null, 2),
    END,
  ].join("\n");
  return message ? `${message}\n\n${context}` : context;
}

/** Removes transport-only editor context before rendering or dequeuing text. */
export function stripEditorSelectionContext(message: string): string {
  const escapedStart = START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message
    .replace(new RegExp(`\\n*${escapedStart}\\n[\\s\\S]*?\\n${escapedEnd}`, "g"), "")
    .trim();
}

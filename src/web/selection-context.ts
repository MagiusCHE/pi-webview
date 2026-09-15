import type { BrowserPageContext, SelectionRange } from "../ide/protocol.ts";

const START = "<pi-webview-editor-selection>";
const END = "</pi-webview-editor-selection>";
const BROWSER_START = "<pi-webview-browser-context>";
const BROWSER_END = "</pi-webview-browser-context>";

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

export function attachBrowserPageContext(
  message: string,
  context: BrowserPageContext | null,
): string {
  if (!context?.url) return message;
  const payload = {
    url: context.url,
    title: context.title,
    ...(context.ranges.length > 0
      ? { ranges: context.ranges.map((range) => ({ text: range.text })) }
      : {}),
  };
  const transportContext = [
    BROWSER_START,
    "The following browser page is currently active. Treat its URL, title, and optional selected text as context for the request:",
    JSON.stringify(payload, null, 2),
    BROWSER_END,
  ].join("\n");
  return message ? `${message}\n\n${transportContext}` : transportContext;
}

function stripBlock(message: string, start: string, end: string): string {
  const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.replace(
    new RegExp(`\\n*${escapedStart}\\n[\\s\\S]*?\\n${escapedEnd}`, "g"),
    "",
  );
}

/** Removes transport-only editor and browser context before rendering or dequeuing. */
export function stripEditorSelectionContext(message: string): string {
  return stripBlock(stripBlock(message, START, END), BROWSER_START, BROWSER_END).trim();
}

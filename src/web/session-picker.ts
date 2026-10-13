import type { SessionInfo } from "../ide/protocol.ts";
import { samePath } from "../ide/paths.ts";

// Only the final directory component is searchable or shown in the picker.
export function sessionDirectoryName(cwd?: string): string {
  return cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

export function filterSessions(
  sessions: SessionInfo[],
  query: string,
  labelFor: (session: SessionInfo) => string,
  locale: string,
): SessionInfo[] {
  const terms = query
    .split(/[\s,]+/)
    .map((term) => term.toLocaleLowerCase(locale))
    .filter(Boolean);
  if (terms.length === 0) return sessions;

  return sessions.filter((session) => {
    const values = [labelFor(session), sessionDirectoryName(session.cwd)].map((value) =>
      value.toLocaleLowerCase(locale),
    );
    // Each term may match either field, but every term must match.
    return terms.every((term) => values.some((value) => value.includes(term)));
  });
}

export function createSessionItemText(
  session: SessionInfo,
  displayLabel: string,
  workspacePath: string | null,
): HTMLSpanElement {
  const text = document.createElement("span");
  text.className = "session-item-text";
  const label = document.createElement("span");
  label.className = "session-item-label";
  label.textContent = displayLabel;
  text.append(label);

  const directoryName = sessionDirectoryName(session.cwd);
  if (directoryName && workspacePath && !samePath(session.cwd, workspacePath)) {
    const directory = document.createElement("span");
    directory.className = "session-item-directory";
    directory.textContent = directoryName;
    text.append(directory);
  }
  return text;
}

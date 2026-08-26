// Loaded-resources info for the new-session welcome banner (Context/Skills/
// Extensions). The pi-side pi-webview extension collects it at session_start
// (mirroring the TUI startup banner, Themes excluded) and writes it to a
// NON-session file (one per pi process pid): it must NEVER be part of the
// session jsonl. The host (VS Code adapter / standalone bridge) serves it to
// the webview via the getStartupInfo IDE request; the webview renders a pure
// UI card in empty sessions only.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface StartupInfo {
  contextFiles: string[];
  skills: string[];
  extensions: string[];
}

const startupDir = (): string => join(homedir(), ".pi", "pi-webview");

/** per-process file: `~/.pi/pi-webview/startup-info-<pid>.json` */
export function startupInfoFile(pid?: number): string {
  return join(startupDir(), `startup-info-${pid ?? process.pid}.json`);
}

/** atomic write (tmp + rename): the webview reads it right after its own
 *  new_session, so the file must never be half-written */
export function writeStartupInfo(info: StartupInfo, pid?: number): void {
  const file = startupInfoFile(pid);
  mkdirSync(startupDir(), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(info));
  renameSync(tmp, file);
}

export function readStartupInfo(pid?: number): StartupInfo | null {
  try {
    const data: unknown = JSON.parse(readFileSync(startupInfoFile(pid), "utf8"));
    if (typeof data !== "object" || data === null) return null;
    const info = data as Partial<StartupInfo>;
    if (
      !Array.isArray(info.contextFiles) ||
      !Array.isArray(info.skills) ||
      !Array.isArray(info.extensions)
    ) {
      return null;
    }
    return {
      contextFiles: info.contextFiles,
      skills: info.skills,
      extensions: info.extensions,
    };
  } catch {
    return null;
  }
}

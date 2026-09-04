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
import type { PackageUpdate, UpdateAvailable } from "../ide/protocol.ts";

export interface StartupInfo {
  contextFiles: string[];
  skills: string[];
  extensions: string[];
  /** newer pi core and/or npm-installed extensions (checked by the pi
   *  extension; absent/null → up-to-date or check not finished) */
  updateAvailable?: UpdateAvailable | null;
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
    const ua = info.updateAvailable;
    // tolerant parsing of { core, extensions } (malformed pieces are dropped
    // rather than failing the whole banner info)
    let updateAvailable: UpdateAvailable | undefined;
    if (ua !== undefined && ua !== null && typeof ua === "object") {
      const coreRaw = (ua as { core?: unknown }).core;
      let core: { current: string; latest: string } | null = null;
      if (
        coreRaw !== null &&
        coreRaw !== undefined &&
        typeof coreRaw === "object" &&
        typeof (coreRaw as { current?: unknown }).current === "string" &&
        typeof (coreRaw as { latest?: unknown }).latest === "string"
      ) {
        core = {
          current: (coreRaw as { current: string }).current,
          latest: (coreRaw as { latest: string }).latest,
        };
      }
      const extRaw = (ua as { extensions?: unknown }).extensions;
      const extensions: PackageUpdate[] = Array.isArray(extRaw)
        ? extRaw
            .filter(
              (e): e is PackageUpdate =>
                e !== null &&
                typeof e === "object" &&
                typeof (e as { name?: unknown }).name === "string" &&
                typeof (e as { current?: unknown }).current === "string" &&
                typeof (e as { latest?: unknown }).latest === "string",
            )
            .map((e) => ({ name: e.name, current: e.current, latest: e.latest }))
        : [];
      updateAvailable = { core, extensions };
    }
    return {
      contextFiles: info.contextFiles,
      skills: info.skills,
      extensions: info.extensions,
      updateAvailable,
    };
  } catch {
    return null;
  }
}

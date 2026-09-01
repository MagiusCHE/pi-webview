// Reading pi sessions for the header dropdown (no LLM).
// Sessions live in ~/.pi/agent/sessions/--<workspace>--/*.jsonl
// (docs/session-format.md of pi). The first record is the header with
// {type:"session", id, cwd, name?}.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { SessionInfo, CliFlags } from "../ide/protocol.ts";
import { samePath, isWindowsPath } from "../ide/paths.ts";

export function defaultSessionDir(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

export function listSessions(
  dir: string = defaultSessionDir(),
  workspace?: string,
): SessionInfo[] {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(dir);
  } catch {
    return [];
  }

  // Prefer the project folder encoded by pi. On Windows, path casing and
  // separators can differ between the IDE, the session header, and the folder
  // created from path.resolve(). If no encoded folder matches, scan the other
  // project folders too and let the session header cwd decide below.
  if (workspace) {
    const matching = projectDirs.filter((d) => projectFolderMatches(d, workspace));
    if (matching.length > 0) projectDirs = matching;
  }

  const out: SessionInfo[] = [];
  for (const proj of projectDirs) {
    const projPath = join(dir, proj);
    let files: string[];
    try {
      files = readdirSync(projPath);
    } catch {
      continue; // not a project folder
    }
    const decodedWorkspace = decodeProjectFolder(proj);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(projPath, f);
      const info = cachedSessionInfo(path);
      // Filter by workspace using Windows path semantics when appropriate.
      // The cwd header is authoritative when folder-name encoding differs.
      if (
        workspace &&
        !samePath(info.cwd, workspace) &&
        !samePath(decodedWorkspace, workspace)
      ) {
        continue;
      }
      out.push(info);
    }
  }

  out.sort(
    (a, b) =>
      (b.lastActivity ?? b.mtime ?? 0) - (a.lastActivity ?? a.mtime ?? 0) ||
      a.path.localeCompare(b.path),
  );
  return out;
}

// Reads the whole file: name (session_info, last one wins), first user
// message, message count (ALL message-type entries, like pi) and last
// activity (max timestamp of message entries, not the file mtime).
// The session name lives in the `session_info` record (docs/session-format.md,
// line 298) — the pi UI shows the name or the first message, with count and
// relative time (dist/modes/interactive/components/session-selector.js).

// Per-file cache based on mtime: reopening the dropdown does not re-read the
// huge files (info recomputed only when the file changed).
const infoCache = new Map<string, { mtime: number; info: SessionInfo }>();

function cachedSessionInfo(path: string): SessionInfo {
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    // file not reachable
  }
  const hit = infoCache.get(path);
  if (hit && hit.mtime === mtime) return hit.info;
  const info: SessionInfo = { path, ...readSessionInfo(path), mtime: mtime || undefined };
  infoCache.set(path, { mtime, info });
  return info;
}

// Updated info of ONE session (to update the name/title at turn end without
// re-reading all files).
export function getSessionInfo(path: string): SessionInfo {
  return cachedSessionInfo(path);
}

/** Resolves a public session id without exposing filesystem paths to the UI URL. */
export function sessionPathForId(
  id: string,
  dir: string = defaultSessionDir(),
): string | undefined {
  return listSessions(dir).find((session) => session.id === id)?.path;
}

// Renames a session (also non-current) by appending a session_info entry to
// the jsonl file — the same format pi uses (appendSessionInfo): the last name
// wins. The name is sanitized like in pi (no newlines, trim).
export function renameSessionFile(path: string, name: string): void {
  const sanitized = name.replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) throw new Error("empty session name");
  if (!path.endsWith(".jsonl") || !existsSync(path)) {
    throw new Error("session not found");
  }
  let parentId: string | undefined;
  for (const raw of readFileSync(path, "utf8").trimEnd().split("\n").reverse()) {
    if (!raw.trim()) continue;
    try {
      const previous = JSON.parse(raw) as { id?: unknown };
      if (typeof previous.id === "string") parentId = previous.id;
    } catch {
      // Keep looking past malformed trailing lines.
    }
    if (parentId) break;
  }
  const entry = {
    type: "session_info",
    id: randomUUID(),
    ...(parentId ? { parentId } : {}),
    timestamp: new Date().toISOString(),
    name: sanitized,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  infoCache.delete(path); // the cache re-reads on next access
}

// Deletes the session file and invalidates the cache.
export function deleteSessionFile(path: string): void {
  if (!path.endsWith(".jsonl")) throw new Error("invalid path");
  if (!existsSync(path)) return; // already gone: idempotent
  unlinkSync(path);
  infoCache.delete(path);
}

function readSessionInfo(path: string): {
  id?: string;
  cwd?: string;
  name?: string;
  model?: { provider: string; id: string };
  firstMessage?: string;
  messageCount?: number;
  lastActivity?: number;
  lastEventAt?: number;
  compactionCount?: number;
} {
  let content = "";
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return {};
  }
  const info: {
    id?: string;
    cwd?: string;
    name?: string;
    model?: { provider: string; id: string };
    firstMessage?: string;
    messageCount?: number;
    lastActivity?: number;
    lastEventAt?: number;
    compactionCount?: number;
  } = {};
  const nodes = new Map<
    string,
    { parentId?: string; model?: { provider: string; id: string } }
  >();
  let leafId: string | undefined;
  let count = 0;
  let compactionCount = 0;
  let lastActivity: number | undefined;
  let lastEventAt: number | undefined;
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "session" && typeof entry.timestamp === "string") {
      const eventTs = Date.parse(entry.timestamp);
      if (Number.isFinite(eventTs)) lastEventAt = eventTs;
    }
    if (entry.type === "compaction") compactionCount++;

    if (entry.type === "session") {
      info.id = typeof entry.id === "string" ? entry.id : undefined;
      info.cwd = typeof entry.cwd === "string" ? entry.cwd : undefined;
    } else if (entry.type === "session_info" && typeof entry.name === "string") {
      // last name wins (including a possible clear)
      info.name = entry.name;
    } else if (entry.type === "message") {
      count++;
      const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(ts)) lastActivity = Math.max(lastActivity ?? 0, ts);
      if (info.firstMessage === undefined) {
        const m = entry.message as { role?: string; content?: unknown } | undefined;
        if (m?.role === "user") {
          const text = userText(m.content);
          if (text) info.firstMessage = text;
        }
      }
    }

    const id = typeof entry.id === "string" ? entry.id : undefined;
    if (entry.type !== "session" && id) {
      const parentId = typeof entry.parentId === "string" ? entry.parentId : undefined;
      let model: { provider: string; id: string } | undefined;
      if (
        entry.type === "model_change" &&
        typeof entry.provider === "string" &&
        typeof entry.modelId === "string"
      ) {
        model = { provider: entry.provider, id: entry.modelId };
      } else if (entry.type === "message") {
        const message = entry.message as
          { role?: string; provider?: string; model?: string } | undefined;
        if (
          message?.role === "assistant" &&
          typeof message.provider === "string" &&
          typeof message.model === "string"
        ) {
          model = { provider: message.provider, id: message.model };
        }
      }
      nodes.set(id, { ...(parentId ? { parentId } : {}), ...(model ? { model } : {}) });
      leafId = id;
    }
  }
  for (let id = leafId; id;) {
    const node = nodes.get(id);
    if (!node) break;
    if (node.model) {
      info.model = node.model;
      break;
    }
    id = node.parentId;
  }
  if (count > 0) info.messageCount = count;
  if (lastActivity !== undefined) info.lastActivity = lastActivity;
  if (lastEventAt !== undefined) info.lastEventAt = lastEventAt;
  info.compactionCount = compactionCount;
  return info;
}

/** Returns the model saved on the session's active branch, if any. */
export function readSessionModel(
  path: string,
): { provider: string; id: string } | undefined {
  return cachedSessionInfo(path).model;
}

/** Forces pi to honor the saved model instead of silently using a default. */
export function sessionModelArgs(path: string): string[] {
  const model = path ? readSessionModel(path) : undefined;
  return model ? ["--provider", model.provider, "--model", model.id] : [];
}

function userText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((b) => (b as { type?: string; text?: string }).text ?? "")
      .join(" ")
      .trim();
    return text;
  }
  return "";
}

// Fork of a session into the current folder — replicates pi's
// SessionManager.forkFrom (docs/session-format.md, dist/core/session-manager.js):
// new session with updated header (workspace cwd, parentSession → source) and
// copy of the non-header entries.
//
// NOTE: the folder name uses - as path separator (same limitation as pi:
// paths with dashes do not round-trip).
export function forkSession(
  sourcePath: string,
  workspace: string,
  dir: string = defaultSessionDir(),
): { path: string } {
  const entries = readFileSync(sourcePath, "utf-8")
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as { type?: string };
      } catch {
        return null;
      }
    })
    .filter((e): e is { type?: string; version?: number } => e !== null);
  const header = entries.find((e) => e.type === "session");
  if (!header) throw new Error("invalid source session (no header)");

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const newHeader = {
    type: "session",
    version: header.version ?? 3,
    id,
    timestamp,
    cwd: workspace,
    parentSession: sourcePath,
  };
  const projDir = join(dir, encodeProjectFolder(workspace));
  mkdirSync(projDir, { recursive: true });
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const newPath = join(projDir, `${fileTimestamp}_${id}.jsonl`);

  writeFileSync(newPath, JSON.stringify(newHeader) + "\n", { flag: "wx" });
  for (const entry of entries) {
    if (entry.type !== "session") appendFileSync(newPath, JSON.stringify(entry) + "\n");
  }
  return { path: newPath };
}

function projectFolderMatches(folder: string, workspace: string): boolean {
  const target = encodeProjectFolder(workspace);
  if (folder === target) return true;
  if (isWindowsPath(workspace) && folder.toLowerCase() === target.toLowerCase()) {
    return true;
  }
  return samePath(decodeProjectFolder(folder), workspace);
}

export function decodeProjectFolder(name: string): string | null {
  if (!name.startsWith("--") || !name.endsWith("--")) return null;
  const inner = name.slice(2, -2);
  if (!inner) return null;
  return "/" + inner.replace(/-/g, "/");
}

// The folder name encodes the workspace with - as separator (same convention
// as pi): on Windows : and \ become - too (--C--proj--, like pi's real
// folders); on Linux it is the same as replace('/', '-'). The round-trip is
// not faithful (pi's limit): matching uses the exact target.
export function encodeProjectFolder(path: string): string {
  const inner = path.replace(/[/\\:]/g, "-").replace(/^-+/, "");
  return `--${inner}--`;
}

// --- per-session custom entries (settings block 3 + session settings) -------
// Saved as a CUSTOM ENTRY in the session jsonl file (NOT in settings, which
// would grow for every session): same format as pi.appendCustomEntry
// ({type:"custom", customType:"...", data:{...}}). Custom entries have no
// role → history ignores them. The LAST entry wins.

const CLI_FLAGS_CUSTOM_TYPE = "pi-webview-cli-flags";
const SESSION_SETTINGS_CUSTOM_TYPE = "pi-webview-session-settings";

/** reads the LAST custom entry of the given type (undefined = never set) */
function readSessionCustomEntry<T>(path: string, customType: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const content = readFileSync(path, "utf-8");
    let data: T | undefined;
    for (const raw of content.split("\n")) {
      if (!raw.trim()) continue;
      let e: { type?: string; customType?: string; data?: unknown };
      try {
        e = JSON.parse(raw) as typeof e;
      } catch {
        continue;
      }
      if (e.type === "custom" && e.customType === customType) {
        data = e.data as T;
      }
    }
    return data;
  } catch {
    return undefined;
  }
}

/** appends a custom entry (parentId = id of the last entry, like pi does
 *  with appendCustomEntry) */
function appendSessionCustomEntry(path: string, customType: string, data: unknown): void {
  if (!existsSync(path)) return;
  try {
    // parentId = id of the last entry (the current leaf), like pi does with
    // appendCustomEntry (parentId: leafId)
    let parentId: string | undefined;
    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = (lines[i] ?? "").trim();
      if (!t) continue;
      try {
        parentId = (JSON.parse(t) as { id?: string }).id;
      } catch {
        // unparseable line: keep walking up
      }
      break;
    }
    const entry = {
      type: "custom",
      customType,
      data,
      id: randomUUID().slice(0, 8),
      ...(parentId ? { parentId } : {}),
      timestamp: new Date().toISOString(),
    };
    appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {
    // best effort: never break Apply because of a failed write
  }
}

/** reads the session's active CLI flags (the last custom entry wins) */
export function readSessionCliFlags(path: string): CliFlags {
  return readSessionCustomEntry<CliFlags>(path, CLI_FLAGS_CUSTOM_TYPE) ?? {};
}

/** writes the session's active CLI flags (append of a custom entry) */
export function writeSessionCliFlags(path: string, flags: CliFlags): void {
  appendSessionCustomEntry(path, CLI_FLAGS_CUSTOM_TYPE, flags);
}

// --- per-session webview settings (notifications override) -------------------

/** per-session overrides saved INSIDE the session file (never in the global
 *  config, which would grow one key per session). Missing field → follow
 *  the global default. */
export interface SessionSettings {
  /** notifications mode for THIS session only */
  notifications?: "desktop" | "vscode" | "off";
}

export function readSessionSettings(path: string): SessionSettings {
  return (
    readSessionCustomEntry<SessionSettings>(path, SESSION_SETTINGS_CUSTOM_TYPE) ?? {}
  );
}

/** replaces the session's settings (full replace: last entry wins; an empty
 *  object removes every override → back to the defaults) */
export function writeSessionSettings(path: string, settings: SessionSettings): void {
  appendSessionCustomEntry(path, SESSION_SETTINGS_CUSTOM_TYPE, settings);
}

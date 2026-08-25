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

  // with an active workspace filter, scan ONLY the project folder
  // (the folder name encodes the workspace: --<path>-- with / → -)
  if (workspace) {
    const target = encodeProjectFolder(workspace);
    projectDirs = projectDirs.filter(
      (d) => d === target || decodeProjectFolder(d) === workspace,
    );
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
      // filter by workspace: header.cwd or decoded folder name
      if (workspace && info.cwd !== workspace && decodedWorkspace !== workspace) continue;
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

// Renames a session (also non-current) by appending a session_info entry to
// the jsonl file — the same format pi uses (appendSessionInfo): the last name
// wins. The name is sanitized like in pi (no newlines, trim).
export function renameSessionFile(path: string, name: string): void {
  const sanitized = name.replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) throw new Error("empty session name");
  if (!path.endsWith(".jsonl") || !existsSync(path)) {
    throw new Error("session not found");
  }
  const entry = {
    type: "session_info",
    id: randomUUID(),
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
  firstMessage?: string;
  messageCount?: number;
  lastActivity?: number;
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
    firstMessage?: string;
    messageCount?: number;
    lastActivity?: number;
  } = {};
  let count = 0;
  let lastActivity: number | undefined;
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
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
  }
  if (count > 0) info.messageCount = count;
  if (lastActivity !== undefined) info.lastActivity = lastActivity;
  return info;
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

function decodeProjectFolder(name: string): string | null {
  if (!name.startsWith("--") || !name.endsWith("--")) return null;
  const inner = name.slice(2, -2);
  if (!inner) return null;
  return "/" + inner.replace(/-/g, "/");
}

function encodeProjectFolder(path: string): string {
  const inner = path.replace(/^\//, "").replace(/\//g, "-");
  return `--${inner}--`;
}

// --- per-session CLI flags (settings block 3) --------------------------------
// Saved as a CUSTOM ENTRY in the session jsonl file (NOT in settings, which
// would grow for every session): same format as pi.appendCustomEntry
// ({type:"custom", customType:"pi-webview-cli-flags", data:{...}}). Custom
// entries have no role → history ignores them. The LAST entry wins.

const CLI_FLAGS_CUSTOM_TYPE = "pi-webview-cli-flags";

/** reads the session's active CLI flags (the last custom entry wins) */
export function readSessionCliFlags(path: string): CliFlags {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf-8");
    let flags: CliFlags = {};
    for (const raw of content.split("\n")) {
      if (!raw.trim()) continue;
      let e: { type?: string; customType?: string; data?: unknown };
      try {
        e = JSON.parse(raw) as typeof e;
      } catch {
        continue;
      }
      if (
        e.type === "custom" &&
        e.customType === CLI_FLAGS_CUSTOM_TYPE &&
        e.data &&
        typeof e.data === "object"
      ) {
        flags = e.data as CliFlags;
      }
    }
    return flags;
  } catch {
    return {};
  }
}

/** writes the session's active CLI flags (append of a custom entry) */
export function writeSessionCliFlags(path: string, flags: CliFlags): void {
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
      customType: CLI_FLAGS_CUSTOM_TYPE,
      data: flags,
      id: randomUUID().slice(0, 8),
      ...(parentId ? { parentId } : {}),
      timestamp: new Date().toISOString(),
    };
    appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {
    // best effort: never break Apply because of a failed write
  }
}

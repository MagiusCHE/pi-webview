// Lettura delle sessioni di pi per la dropdown nell'header (senza LLM).
// Le sessioni vivono in ~/.pi/agent/sessions/--<workspace>--/*.jsonl
// (docs/session-format.md di pi). Il primo record è l'header con
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

  // con filtro workspace attivo, scandisci SOLO la cartella del progetto
  // (il nome cartella codifica il workspace: --<path>-- con / → -)
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
      continue; // non è una cartella di progetto
    }
    const decodedWorkspace = decodeProjectFolder(proj);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(projPath, f);
      const info = cachedSessionInfo(path);
      // filtra per workspace: header.cwd oppure nome cartella decodificato
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

// Legge tutto il file: nome (session_info, ultimo), primo messaggio utente,
// conteggio messaggi (TUTTE le entry di tipo message, come pi) e ultima
// attività (timestamp massimo delle entry di messaggio, non l'mtime del file).
// Il nome della sessione vive nel record `session_info` (docs/session-format.md,
// riga 298) — la UI di pi mostra nome oppure primo messaggio, con conteggio e
// tempo relativo (dist/modes/interactive/components/session-selector.js).

// Cache per file basata su mtime: le riaperture della dropdown non rileggono
// i file enormi (info ricalcolata solo se il file è cambiato).
const infoCache = new Map<string, { mtime: number; info: SessionInfo }>();

function cachedSessionInfo(path: string): SessionInfo {
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    // file non raggiungibile
  }
  const hit = infoCache.get(path);
  if (hit && hit.mtime === mtime) return hit.info;
  const info: SessionInfo = { path, ...readSessionInfo(path), mtime: mtime || undefined };
  infoCache.set(path, { mtime, info });
  return info;
}

// Info aggiornata di UNA sessione (per aggiornare nome/titolo a fine turno
// senza rileggere tutti i file).
export function getSessionInfo(path: string): SessionInfo {
  return cachedSessionInfo(path);
}

// Rinomina una sessione (anche NON corrente) appendendo una entry session_info
// al file jsonl — stesso formato che usa pi (appendSessionInfo): l'ultimo nome
// vince. Il nome viene sanificato come in pi (niente a capo, trim).
export function renameSessionFile(path: string, name: string): void {
  const sanitized = name.replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) throw new Error("nome sessione vuoto");
  if (!path.endsWith(".jsonl") || !existsSync(path)) {
    throw new Error("sessione non trovata");
  }
  const entry = {
    type: "session_info",
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    name: sanitized,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  infoCache.delete(path); // la cache rilegge al prossimo accesso
}

// Elimina il file di sessione e invalida la cache.
export function deleteSessionFile(path: string): void {
  if (!path.endsWith(".jsonl")) throw new Error("percorso non valido");
  if (!existsSync(path)) return; // già assente: idempotente
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
      // ultimo nome (incluso un eventuale clear)
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

// Fork di una sessione nella cartella corrente — replica SessionManager.forkFrom
// di pi (docs/session-format.md, dist/core/session-manager.js): nuova sessione
// con header aggiornato (cwd del workspace, parentSession → sorgente) e copia
// delle entry non-header.
//
// NB: il nome cartella usa - come separatore dei path (stessa limitazione di pi:
// i path con trattini non fanno round-trip).
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
  if (!header) throw new Error("sessione sorgente non valida (nessun header)");

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

// --- flag CLI per-sessione (blocco 3 settings) --------------------------------
// Salvati come ENTRY CUSTOM nel file jsonl della sessione (NON nei settings,
// che crescerebbero per ogni sessione): formato identico a pi.appendCustomEntry
// ({type:"custom", customType:"pi-webview-cli-flags", data:{...}}). Le entry
// custom non hanno role → la cronologia le ignora. L'ULTIMA entry vince.

const CLI_FLAGS_CUSTOM_TYPE = "pi-webview-cli-flags";

/** legge i flag CLI attivi della sessione (l'ultima entry custom vince) */
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

/** scrive i flag CLI attivi della sessione (append di una entry custom) */
export function writeSessionCliFlags(path: string, flags: CliFlags): void {
  if (!existsSync(path)) return;
  try {
    // parentId = id dell'ultima entry (il foglio corrente), come pi fa con
    // appendCustomEntry (parentId: leafId)
    let parentId: string | undefined;
    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = (lines[i] ?? "").trim();
      if (!t) continue;
      try {
        parentId = (JSON.parse(t) as { id?: string }).id;
      } catch {
        // riga non parseabile: continua a risalire
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
    // best effort: mai rompere l'Applica per una scrittura fallita
  }
}

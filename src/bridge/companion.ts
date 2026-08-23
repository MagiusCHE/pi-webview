// Verifica del companion VS Code, eseguita da `piw` all'avvio (best effort,
// non blocca mai il bridge). Divisione dei compiti:
//   - estensione pi all'avvio: SOLO ensure del link `piw`
//   - `piw` all'avvio: SOLO verifica/installazione del companion VS Code
// Il check è idempotente: se il companion installato ha la stessa versione
// del vsix incluso nel pacchetto non fa nulla. Se `code` non è nella PATH
// (nessun VS Code / CLI non integrata) skippa in silenzio.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const execFileAsync = promisify(execFile);

const COMPANION_ID = "magiusche.pi-webview-ide";
const VSIX_NAME = "pi-webview-ide.vsix";

// Segnale di reload per l'IDE (contratto multi-IDE, docs/concept/0004): stesso
// file scritto dall'estensione pi — quando il companion viene AGGIORNATO mentre
// l'IDE è aperto, il companion (in esecuzione) legge qui la versione target e
// chiede il reload della finestra.
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

function writeReloadSignal(version: string): void {
  try {
    mkdirSync(dirname(RELOAD_SIGNAL), { recursive: true });
    writeFileSync(RELOAD_SIGNAL, JSON.stringify({ version }, null, 2) + "\n");
  } catch {
    // best effort
  }
}

function clearReloadSignal(): void {
  try {
    rmSync(RELOAD_SIGNAL, { force: true });
  } catch {
    // best effort
  }
}

// --- lettura versione dal vsix (zip, solo node:fs + node:zlib) -------------

const LOCAL_FILE_HEADER = 0x04034b50;

function readVsixVersion(vsixPath: string): string | undefined {
  const buf = readFileSync(vsixPath);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== LOCAL_FILE_HEADER) return undefined;
    const method = buf.readUInt16LE(offset + 8); // 0 = stored, 8 = deflate
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;

    if (name === "extension.vsixmanifest") {
      const raw = buf.subarray(dataStart, dataStart + compressedSize);
      let xml: string;
      if (method === 0) xml = raw.toString("utf8");
      else if (method === 8) xml = inflateRawSync(raw).toString("utf8");
      else return undefined;
      return /<Identity[^>]*\bVersion="([^"]+)"/.exec(xml)?.[1];
    }

    offset = dataStart + compressedSize;
  }
  return undefined;
}

// --- CLI `code` portabile (su Windows è un .cmd: serve cmd /c) --------------

function runCode(args: string[], timeoutMs: number): Promise<string> {
  if (process.platform === "win32") {
    const quoted = args.map((a) =>
      /[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a,
    );
    return execFileAsync("cmd", ["/c", "code", ...quoted], {
      timeout: timeoutMs,
      windowsHide: true,
    }).then((r) => r.stdout);
  }
  return execFileAsync("code", args, { timeout: timeoutMs }).then((r) => r.stdout);
}

async function installedCompanionVersion(): Promise<string | null> {
  const out = await runCode(["--list-extensions", "--show-versions"], 15_000);
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(COMPANION_ID)) {
      const m = /@([^@\s]+)\s*$/.exec(t);
      return m ? (m[1] ?? "") : "";
    }
  }
  return null;
}

/**
 * Verifica il companion VS Code rispetto al vsix incluso nel pacchetto e lo
 * installa/aggiorna se manca o è datato. Best effort: ogni errore (code CLI
 * assente, lettura vsix fallita, install fallita) viene solo segnalato.
 * Ritorna il messaggio da stampare in console (o null se niente da dire).
 */
export async function ensureVscodeCompanion(packageRoot: string): Promise<string | null> {
  const vsixPath = join(packageRoot, "companion", VSIX_NAME);
  try {
    const vsixVersion = readVsixVersion(vsixPath);
    if (vsixVersion === undefined) return null; // vsix non leggibile: skip
    const installed = await installedCompanionVersion();
    if (installed !== null && installed === vsixVersion) {
      clearReloadSignal(); // già aggiornato: nessun segnale pendente
      return null; // ok
    }
    await runCode(["--install-extension", vsixPath, "--force"], 60_000);
    // update (non installazione fresca) → segnala all'IDE aperto il reload
    if (installed !== null) writeReloadSignal(vsixVersion);
    return installed === null
      ? `piw: companion VS Code installato (${vsixVersion}). Reload della finestra VS Code per attivare la webview.`
      : `piw: companion VS Code aggiornato ${installed} → ${vsixVersion}. Reload della finestra VS Code.`;
  } catch {
    return null; // code mancante / errore: mai rompere l'avvio del bridge
  }
}

// VS Code companion check, run by `piw` at startup (best effort, never
// blocks the bridge). Task split:
//   - pi extension at startup: ONLY the `piw` link ensure
//   - `piw` at startup: ONLY VS Code companion check/install
// The check is idempotent: if the installed companion matches the vsix
// bundled in the package it does nothing. If `code` is not on the PATH (no
// VS Code / CLI not integrated) it skips silently.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const execFileAsync = promisify(execFile);

const COMPANION_ID = "magiusche.pi-webview-ide";
const VSIX_NAME = "pi-webview-ide.vsix";

// Reload signal for the IDE (multi-IDE contract, docs/concept/0004): same
// file written by the pi extension — when the companion is UPDATED while the
// IDE is open, the companion (running) reads the target version here and
// asks for a window reload.
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

// --- reading the version from the vsix (zip, only node:fs + node:zlib) ----

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

// --- portable `code` CLI (on Windows it is a .cmd: needs cmd /c) -----------

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
 * Checks the VS Code companion against the vsix bundled in the package and
 * installs/updates it if missing or outdated. Best effort: any error (missing
 * code CLI, failed vsix read, failed install) is only reported.
 * Returns the message to print on console (or null if nothing to say).
 */
export async function ensureVscodeCompanion(packageRoot: string): Promise<string | null> {
  const vsixPath = join(packageRoot, "companion", VSIX_NAME);
  try {
    const vsixVersion = readVsixVersion(vsixPath);
    if (vsixVersion === undefined) return null; // vsix unreadable: skip
    const installed = await installedCompanionVersion();
    if (installed !== null && installed === vsixVersion) {
      clearReloadSignal(); // already updated: no pending signal
      return null; // ok
    }
    await runCode(["--install-extension", vsixPath, "--force"], 60_000);
    // update (not fresh install) → signal the open IDE to reload
    if (installed !== null) writeReloadSignal(vsixVersion);
    return installed === null
      ? `piw: companion VS Code installato (${vsixVersion}). Reload della finestra VS Code per attivare la webview.`
      : `piw: companion VS Code aggiornato ${installed} → ${vsixVersion}. Reload della finestra VS Code.`;
  } catch {
    return null; // missing code / error: never break the bridge startup
  }
}

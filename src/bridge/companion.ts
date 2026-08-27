// VS Code companion check, run by `piw` at startup (best effort, never
// blocks the bridge). Task split:
//   - pi extension at startup: ONLY the `piw` link ensure
//   - `piw` at startup: ONLY VS Code companion check/install
// The check is idempotent: if the installed companion matches the vsix
// bundled in the package it does nothing. If `code` is not on the PATH (no
// VS Code / CLI not integrated) it skips silently.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// --- `code` CLI resolution -------------------------------------------------
// `code` may be missing from the PATH of the process that started piw (a
// terminal opened before VS Code was installed, or a launcher with a reduced
// PATH) even when VS Code itself is installed. Resolution order:
//   1. PATH lookup (where/which), keeping only real executables on Windows
//      (`where` also lists the extension-less bash script `…\bin\code`);
//   2. known install locations per platform;
//   3. last resort: direct vsix extraction into the extensions folder — VS
//      Code picks folders up by scanning, no CLI involved.
function codeCliKnownPaths(): string[] {
  if (process.platform === "win32") {
    return [
      // per-user install (the default)
      join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "Microsoft VS Code",
        "bin",
        "code.cmd",
      ),
      // machine-wide install
      join(process.env.ProgramFiles ?? "", "Microsoft VS Code", "bin", "code.cmd"),
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"];
  }
  return [
    "/usr/bin/code",
    "/usr/local/bin/code",
    "/snap/bin/code",
    "/var/lib/flatpak/exports/bin/com.visualstudio.code",
    join(
      homedir(),
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      "com.visualstudio.code",
    ),
  ];
}

async function resolveCodeCli(): Promise<string | null> {
  try {
    const probe = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(probe, ["code"], {
      timeout: 5_000,
      windowsHide: true,
    });
    for (const line of stdout.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      if (process.platform === "win32") {
        if (/\.(cmd|exe|bat)$/i.test(p)) return p;
      } else if (existsSync(p)) {
        return p;
      }
    }
  } catch {
    // not on PATH
  }
  for (const p of codeCliKnownPaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

function runCode(cli: string, args: string[], timeoutMs: number): Promise<string> {
  if (process.platform === "win32") {
    // cmd /c quoting: wrap the WHOLE command line in quotes and use /s so
    // cmd strips only the outer pair — keeps full paths with spaces intact.
    const cmdLine = [cli, ...args]
      .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(" ");
    return execFileAsync("cmd", ["/d", "/s", "/c", `"${cmdLine}"`], {
      timeout: timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: true,
    }).then((r) => r.stdout);
  }
  return execFileAsync(cli, args, { timeout: timeoutMs }).then((r) => r.stdout);
}

async function installedCompanionVersion(cli: string): Promise<string | null> {
  const out = await runCode(cli, ["--list-extensions", "--show-versions"], 15_000);
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(COMPANION_ID)) {
      const m = /@([^@\s]+)\s*$/.exec(t);
      return m ? (m[1] ?? "") : "";
    }
  }
  return null;
}

// --- Level 2: install without the CLI --------------------------------------

function vsCodeExtensionsDir(): string {
  return process.platform === "win32"
    ? join(process.env.USERPROFILE ?? "", ".vscode", "extensions")
    : join(homedir(), ".vscode", "extensions");
}

function findVsCodeCompanionFolder(dir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  // highest version wins (readdir order is not deterministic)
  let best: string | null = null;
  let bestVersion: string | null = null;
  for (const name of entries) {
    if (!name.toLowerCase().startsWith(`${COMPANION_ID}-`)) continue;
    const version = name.slice(COMPANION_ID.length + 1);
    if (bestVersion === null || compareVersions(version, bestVersion) > 0) {
      best = join(dir, name);
      bestVersion = version;
    }
  }
  return best;
}

// numeric semver compare ("0.10.0" > "0.9.0"), missing segments = 0
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readInstalledCompanionVersion(folder: string): string | null {
  try {
    const json = JSON.parse(readFileSync(join(folder, "package.json"), "utf-8")) as {
      version?: unknown;
    };
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  }
}

async function installVsCodeCompanionDirect(
  vsixPath: string,
  vsixVersion: string,
): Promise<string | null> {
  const dir = vsCodeExtensionsDir();
  if (!existsSync(dir)) return null; // VS Code never started: skip silently
  const installedFolder = findVsCodeCompanionFolder(dir);
  const installedVersion = installedFolder
    ? readInstalledCompanionVersion(installedFolder)
    : null;
  if (installedVersion !== null && installedVersion === vsixVersion) {
    clearReloadSignal();
    return null; // already current
  }
  // extract OUTSIDE the extensions dir (sibling ~/.vscode) so VS Code never
  // sees the half-written folder; same filesystem → rename works on all OS
  const tmp = join(dirname(dir), `.${COMPANION_ID}-${vsixVersion}.tmp`);
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    // tar reads zips on Windows 10+ (bsdtar), macOS and Linux
    await execFileAsync("tar", ["-xf", vsixPath, "-C", tmp], {
      timeout: 60_000,
      windowsHide: true,
    });
    // `code --install-extension` strips these two from the folder
    for (const f of ["extension.vsixmanifest", "[Content_Types].xml"]) {
      rmSync(join(tmp, f), { force: true });
    }
    rmSync(join(tmp, "__MACOSX"), { recursive: true, force: true });
    if (installedFolder) rmSync(installedFolder, { recursive: true, force: true });
    const dest = join(dir, `${COMPANION_ID}-${vsixVersion}`);
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);
    if (installedVersion !== null) writeReloadSignal(vsixVersion);
    return installedVersion === null
      ? `piw: companion VS Code installato (${vsixVersion}). Reload della finestra VS Code per attivare la webview.`
      : `piw: companion VS Code aggiornato ${installedVersion} → ${vsixVersion}. Reload della finestra VS Code.`;
  } catch {
    rmSync(tmp, { recursive: true, force: true }); // best effort cleanup
    return null; // never break the bridge startup
  }
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
    const cli = await resolveCodeCli();
    if (cli) {
      const installed = await installedCompanionVersion(cli);
      if (installed !== null && installed === vsixVersion) {
        clearReloadSignal(); // already updated: no pending signal
        return null; // ok
      }
      await runCode(cli, ["--install-extension", vsixPath, "--force"], 60_000);
      // update (not fresh install) → signal the open IDE to reload
      if (installed !== null) writeReloadSignal(vsixVersion);
      return installed === null
        ? `piw: companion VS Code installato (${vsixVersion}). Reload della finestra VS Code per attivare la webview.`
        : `piw: companion VS Code aggiornato ${installed} → ${vsixVersion}. Reload della finestra VS Code.`;
    }
    // no `code` CLI anywhere → last resort: direct extraction into the
    // extensions folder
    return await installVsCodeCompanionDirect(vsixPath, vsixVersion);
  } catch {
    return null; // missing code / error: never break the bridge startup
  }
}

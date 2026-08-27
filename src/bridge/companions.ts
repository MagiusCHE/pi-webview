// Centralized IDE-companion check/install for the pi-webview package.
//
// ONE implementation, called from every entry point:
//   - the pi extension (packages/pi-webview/extension.ts) — surfaces the
//     notes through ui.notify (visible in the pi.dev TUI and in the webview);
//   - `piw` (src/bridge/piw.ts) — prints the notes to the console.
//
// Behavior contract (identical everywhere):
//   - the target app is not installed (no `code` CLI and no extensions
//     folder, or no Visual Studio instance) → silent skip, no notes;
//   - the installed companion already matches the bundled vsix → silent skip;
//   - anything else (installed / updated / failed) → a CompanionNote is
//     returned so the caller can surface it.
// Disabled entirely with PI_WEBVIEW_AUTO_INSTALL=0 (checked here, so piw and
// the pi extension behave the same).

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
  type Dirent,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readVsixVersion } from "../../packages/pi-webview/lib/vsix-version.ts";

const execFileAsync = promisify(execFile);

export const COMPANION_ID = "magiusche.pi-webview-ide";
export const VSIX_ID = "PiWebview.Vs.4d433864-8ac9-420a-bc57-700940833fc6";
export const VSCODE_VSIX_NAME = "pi-webview-ide.vsix";
export const VS_VSIX_NAME = "pi-webview-visualstudio.vsix";
export const AUTO_INSTALL_ENV = "PI_WEBVIEW_AUTO_INSTALL";

// Reload signal for the IDE (multi-IDE contract, docs/concept/0004): when a
// companion is UPDATED while the IDE is open, the window stays on the old
// version loaded in memory → write the target version here; the IDE
// companion (running) reads it and asks for a reload. Fresh installs never
// write it.
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

function writeReloadSignal(version: string): void {
  try {
    mkdirSync(dirname(RELOAD_SIGNAL), { recursive: true });
    writeFileSync(RELOAD_SIGNAL, JSON.stringify({ version }, null, 2) + "\n");
  } catch {
    // best effort: never break installation because of a signal
  }
}

function clearReloadSignal(): void {
  try {
    rmSync(RELOAD_SIGNAL, { force: true });
  } catch {
    // best effort
  }
}

// --- running external commands ----------------------------------------------

// Runs a CLI portably: on Windows `code` is a `.cmd`, which Node does not
// run with execFile → go through `cmd /c` with quoting of the paths (which
// on Windows often contain spaces).
export async function runCli(
  cli: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    // cmd /c quoting: wrap the WHOLE command line in quotes and use /s so
    // cmd strips only the outer pair — keeps full paths with spaces intact.
    const cmdLine = [cli, ...args]
      .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(" ");
    return execFileAsync("cmd", ["/d", "/s", "/c", `"${cmdLine}"`], {
      timeout,
      windowsHide: true,
      windowsVerbatimArguments: true,
    }).catch((err: unknown) => {
      // cmd itself ran, so a missing CLI exits 1 with a localized "not
      // recognized" message instead of ENOENT — normalize so callers treat
      // it as "CLI not on PATH" (silent skip, same as ENOENT on Unix).
      const stderr = String((err as { stderr?: unknown })?.stderr ?? "");
      if (
        /not (recognized|found)|non (è|e') riconosciuto|nicht (erkannt|gefunden)|не является|no se reconoce/i.test(
          stderr,
        )
      ) {
        const e = new Error(`command not found: ${cli}`);
        (e as NodeJS.ErrnoException).code = "ENOENT";
        throw e;
      }
      throw err;
    });
  }
  return execFileAsync(cli, args, { timeout });
}

async function listExtensions(cli: string): Promise<string> {
  const { stdout } = await runCli(cli, ["--list-extensions", "--show-versions"], 15_000);
  return stdout;
}

// Installed companion version (e.g. `magiusche.pi-webview-ide@0.1.0`),
// `null` if not installed, "" if present but without a version.
export async function installedCompanionVersion(cli: string): Promise<string | null> {
  const out = await listExtensions(cli);
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(COMPANION_ID)) {
      const m = /@([^@\s]+)\s*$/.exec(t);
      return m ? (m[1] ?? "") : "";
    }
  }
  return null;
}

export async function installCompanion(cli: string, vsixPath: string): Promise<void> {
  await runCli(cli, ["--install-extension", vsixPath, "--force"], 60_000);
}

// --- VS Code CLI resolution (Level 1) --------------------------------------
// `code` may be missing from the PATH of the process that started pi (a
// terminal opened before VS Code was installed, or a launcher with a reduced
// PATH) even when VS Code itself is installed. Resolution order:
//   1. PATH lookup (where/which), keeping only real executables on Windows
//      (`where` also lists the extension-less bash script `…\bin\code`);
//   2. known install locations per platform;
//   3. last resort (Level 2): direct vsix extraction into the extensions
//      folder — VS Code picks folders up by scanning, no CLI involved.
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

export async function resolveCodeCli(): Promise<string | null> {
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

// --- VS Code companion install without the CLI (Level 2) --------------------
// Last resort when no `code` CLI can be resolved: unzip the vsix straight
// into the VS Code extensions folder (~/.vscode/extensions on all platforms)
// with the same layout `code --install-extension` produces
// (<publisher>.<name>-<version>). Best effort: anything failing is reported
// and never breaks startup.

export function vsCodeExtensionsDir(): string {
  return process.platform === "win32"
    ? join(process.env.USERPROFILE ?? "", ".vscode", "extensions")
    : join(homedir(), ".vscode", "extensions");
}

// Installed companion folder: the HIGHEST version matching
// `magiusche.pi-webview-ide-*` (readdir order is not deterministic, and a
// leftover old version must never shadow the current one).
export function findVsCodeCompanionFolder(dir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null; // unreadable/missing extensions dir
  }
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

export function readVsCodeCompanionVersion(folder: string): string | null {
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
  force: boolean,
): Promise<CompanionNote | null> {
  const dir = vsCodeExtensionsDir();
  if (!existsSync(dir)) return null; // VS Code never started: silent skip
  const installedFolder = findVsCodeCompanionFolder(dir);
  const installedVersion = installedFolder
    ? readVsCodeCompanionVersion(installedFolder)
    : null;
  if (!force && installedVersion !== null && installedVersion === vsixVersion) {
    clearReloadSignal(); // already current
    return null;
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
      ? { target: "vscode", kind: "installed", version: vsixVersion }
      : {
          target: "vscode",
          kind: "updated",
          version: vsixVersion,
          fromVersion: installedVersion,
        };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true }); // best effort cleanup
    return {
      target: "vscode",
      kind: "error",
      error: describeExecError(err),
    };
  }
}

// execFile errors: Node's message is "Command failed: <cmd>" WITHOUT the
// child's stderr — quiet-mode failures (VSIXInstaller /q, code CLI) carry
// the real reason on stderr, so include it (truncated) or the user only
// sees the command line.
function describeExecError(err: unknown): string {
  const e = err as { message?: unknown; stderr?: unknown };
  const base = typeof e?.message === "string" ? e.message : String(err);
  const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : "";
  if (!stderr) return base;
  const MAX = 400;
  const snippet = stderr.length > MAX ? `${stderr.slice(0, MAX)}…` : stderr;
  return `${base}\n  stderr: ${snippet}`;
}

// --- Visual Studio companion (multi-IDE, Fase 3) ----------------------------
// VS has no CLI like `code`: detection goes through vswhere.exe (shipped
// with the VS Installer) and the vsix is installed with VSIXInstaller.exe
// (quiet). Only runs on Windows; a missing vswhere/vsix → silent skip.

// candidate paths of vswhere.exe, newest first
function vswhereCandidates(): string[] {
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return [
    join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe"),
    join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe") + ".exe",
  ];
}

// VS instances discovered via vswhere. VSIXInstaller needs the instanceId
// (/instanceIds:) to target a SPECIFIC instance — without it the vsix goes
// into the NEWEST instance only, so older ones (e.g. VS 2022 when VS 2026 is
// present) would never get the companion.
export interface VsInstance {
  id: string; // instanceId — the `<id>` part of `17.0_<id>` in LocalAppData
  path: string; // installationPath (VSIXInstaller.exe lives under Common7\IDE)
  version: string; // installationVersion (e.g. "17.8.5")
  displayName: string;
}

// Parses `vswhere -format json` output. vswhere may prefix the json with its
// version banner, which itself contains brackets ("[query version …]") — look
// for the array at the START of a line first, then fall back to the first '['.
export function parseVsInstances(stdout: string): VsInstance[] {
  const lineStart = stdout.search(/^\s*\[/m);
  const start = lineStart >= 0 ? lineStart : stdout.indexOf("[");
  if (start < 0) return [];
  try {
    const raw = JSON.parse(stdout.slice(start)) as Array<Record<string, unknown>>;
    return raw
      .map((r) => ({
        id: String(r.instanceId ?? ""),
        path: String(r.installationPath ?? ""),
        version: String(r.installationVersion ?? ""),
        displayName: String(r.displayName ?? ""),
      }))
      .filter((i) => i.id && i.path);
  } catch {
    return [];
  }
}

// InstallationTarget range in source.extension.vsixmanifest ([17.0, 19.0)):
// VS 2019 (16.x) never matches → skip it instead of letting VSIXInstaller
// fail on a version mismatch.
export function isVsVersionSupported(version: string): boolean {
  const major = parseInt(version, 10);
  return Number.isFinite(major) && major >= 17 && major < 19;
}

export async function visualStudioInstances(): Promise<VsInstance[]> {
  if (process.platform !== "win32") return [];
  const vswhere = vswhereCandidates().find((p) => existsSync(p));
  if (!vswhere) return [];
  try {
    // -prerelease: VS 2026 (18.0) is a preview — vswhere skips prerelease
    // instances without it, so the companion would never install.
    // No -requires: a workload filter hides instances lacking that specific
    // workload, while VSIXInstaller.exe works for every full VS install.
    // No -property flags: vswhere keeps only the LAST -property when repeated
    // (observed on the real CLI), which broke the parse (empty instanceId +
    // installationPath → every instance filtered out). The default JSON
    // already includes all the fields parseVsInstances needs.
    const { stdout } = await execFileAsync(
      vswhere,
      ["-products", "*", "-prerelease", "-format", "json"],
      { timeout: 15_000, windowsHide: true },
    );
    return parseVsInstances(stdout);
  } catch {
    return [];
  }
}

// All versions found for an extension id under a root (bounded walk): a
// directory may hold several copies of the same extension (e.g. a stale
// all-users install next to a newer per-user one), and readdir order is
// unspecified — a first-match scan would read an arbitrary one of them.
// Callers that decide "installed vs bundled" must see ALL of them. [] when
// nothing found; "" for a manifest that lacks Version.
export function findVsixManifestVersions(
  root: string,
  id: string,
  maxDepth: number,
): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir (permissions): skip
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".cache") continue; // VS cache dirs
        walk(p, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase() === "extension.vsixmanifest"
      ) {
        try {
          const xml = readFileSync(p, "utf-8");
          const at = xml.indexOf(`Id="${id}"`);
          if (at >= 0)
            out.push(/Version="([^"]+)"/.exec(xml.slice(at, at + 200))?.[1] ?? "");
        } catch {
          // unreadable manifest: keep scanning
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

// First match found under the root, or null. Kept for the layout tests: the
// install/version check uses findVsixManifestVersions + pickHighestVersion.
export function findVsixManifestVersion(
  root: string,
  id: string,
  maxDepth: number,
): string | null {
  return findVsixManifestVersions(root, id, maxDepth)[0] ?? null;
}

// Highest version in a list (numeric semver), null when the list is empty.
// An empty-string entry (manifest without Version) counts only when no
// versioned copy exists.
export function pickHighestVersion(versions: string[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (v === "") {
      if (best === null) best = "";
      continue;
    }
    if (best === null || best === "" || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

// Installed VS companion version for ONE instance: the admin install (/a)
// goes into <install>\Common7\IDE\Extensions, per-user installs into
// %LocalAppData%\Microsoft\VisualStudio\<major>.0_<instanceId>\Extensions.
// Scans ALL roots and returns the HIGHEST version found: a stale copy (e.g.
// an old all-users install that per-user updates never touch) must not
// shadow the current one — a first-match scan would reinstall at every pi
// start (the reported VS "0.2.2 → 0.2.3" loop). Per-instance scan: an
// instance that already has the current version must not make every other
// instance skip too.
async function installedVsCompanionVersion(inst: VsInstance): Promise<string | null> {
  const roots = [join(inst.path, "Common7", "IDE", "Extensions")];
  const major = inst.version.split(".")[0];
  const localVs = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft", "VisualStudio")
    : "";
  if (localVs && major) roots.push(join(localVs, `${major}.0_${inst.id}`, "Extensions"));
  const versions: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root) || !existsSync(root)) continue;
    seen.add(root);
    versions.push(...findVsixManifestVersions(root, VSIX_ID, 6));
  }
  return pickHighestVersion(versions);
}

// --- unified entry point -----------------------------------------------------

export interface CompanionNote {
  target: "vscode" | "visualstudio";
  kind: "installed" | "updated" | "error";
  label?: string; // VS instance display name
  version?: string; // target (vsix) version
  fromVersion?: string; // previous installed version
  error?: string;
}

/**
 * Checks BOTH companions (VS Code + Visual Studio) against the vsixes bundled
 * in the package and installs/updates them when missing or outdated.
 * Returns the notes to surface (empty = nothing to report: app not
 * installed or companions already current — silent skip). With
 * `opts.force` the version compare is skipped and the companions are
 * reinstalled (used by the explicit /piw reinstall command).
 * `opts.onStep(step, action)` receives a human-readable progress line for
 * EVERY phase (including silent skips). `action` is true only for steps
 * that LEAD to work being done (installing…, retrying…, error —…): the
 * caller buffers the check steps and flushes them at the FIRST action
 * (before the install runs), then streams — total silence when no action
 * ever happens (everything already current).
 * `opts.ignoreAutoInstall` skips the PI_WEBVIEW_AUTO_INSTALL env
 * switch (explicit commands always run).
 * Never throws: every failure becomes an error note.
 */
export async function ensureCompanions(
  packageRoot: string,
  opts: {
    force?: boolean;
    onStep?: (step: string, action?: boolean) => void;
    ignoreAutoInstall?: boolean;
  } = {},
): Promise<CompanionNote[]> {
  const force = opts.force === true;
  // step: progress trace emitted for EVERY phase (even silent skips); the
  // second arg marks steps that lead to actual work (install/update/error)
  const step = (s: string, action = false): void => opts.onStep?.(s, action);
  // explicit commands (/piw install, reinstall) always run; the env switch
  // only disables the AUTOMATIC startup check
  if (!opts.ignoreAutoInstall) {
    const autoInstall = (process.env[AUTO_INSTALL_ENV] ?? "1").trim().toLowerCase();
    if (["0", "false", "off", "none"].includes(autoInstall)) {
      step("auto-install disabled (PI_WEBVIEW_AUTO_INSTALL=0)");
      return [];
    }
  }
  const notes: CompanionNote[] = [];

  // 1) VS Code companion
  const vsCodeVsix = join(packageRoot, "companion", VSCODE_VSIX_NAME);
  let vsixVersion: string | undefined;
  try {
    vsixVersion = readVsixVersion(vsCodeVsix);
  } catch {
    vsixVersion = undefined;
  }
  if (vsixVersion === undefined) {
    step("VS Code: bundled vsix unreadable or missing");
    notes.push({
      target: "vscode",
      kind: "error",
      error: "bundled vsix unreadable or missing",
    });
  } else {
    try {
      step("VS Code: checking code CLI…");
      const cli = await resolveCodeCli();
      if (cli) {
        const installed = await installedCompanionVersion(cli);
        if (!force && installed !== null && installed === vsixVersion) {
          clearReloadSignal(); // already current: no pending signal
          step(`VS Code: companion already current (${vsixVersion})`);
        } else {
          step(
            `VS Code: installing ${vsixVersion}${installed === null ? "" : ` (${installed} → ${vsixVersion})`}…`,
            true,
          );
          await installCompanion(cli, vsCodeVsix);
          // update (not fresh install) → signal the open IDE to reload
          if (installed !== null) writeReloadSignal(vsixVersion);
          step(
            installed === null
              ? `VS Code: companion installed (${vsixVersion})`
              : `VS Code: companion updated (${installed} → ${vsixVersion})`,
          );
          notes.push({
            target: "vscode",
            kind: installed === null ? "installed" : "updated",
            version: vsixVersion,
            ...(installed !== null ? { fromVersion: installed } : {}),
          });
        }
      } else {
        // no `code` CLI anywhere → last resort: direct vsix extraction into
        // the extensions folder (VS Code scans folders, no CLI involved)
        step("VS Code: no code CLI — direct vsix extraction", true);
        const direct = await installVsCodeCompanionDirect(vsCodeVsix, vsixVersion, force);
        if (direct) {
          step(`VS Code: ${direct.kind === "error" ? "error" : "installed"} (${vsixVersion})`, true);
          notes.push(direct);
        }
      }
    } catch (err) {
      const desc = describeExecError(err);
      step(`VS Code: error — ${desc}`, true);
      notes.push({
        target: "vscode",
        kind: "error",
        error: desc,
      });
    }
  }

  // 2) Visual Studio companion (Windows only, silent when no VS / no vsix)
  const vsVsix = join(packageRoot, "companion", VS_VSIX_NAME);
  if (existsSync(vsVsix)) {
    let vsVsixVersion: string | undefined;
    try {
      vsVsixVersion = readVsixVersion(vsVsix);
    } catch {
      vsVsixVersion = undefined;
    }
    if (vsVsixVersion === undefined) {
      step("Visual Studio: bundled vsix unreadable");
      notes.push({
        target: "visualstudio",
        kind: "error",
        error: "bundled vsix unreadable",
      });
    } else {
      try {
        step("Visual Studio: checking instances…");
        const instances = await visualStudioInstances();
        for (const inst of instances) {
          // displayName already starts with "Visual Studio " — strip it, the
          // steps/notes add the "Visual Studio" context themselves
          const label = (inst.displayName || `VS ${inst.version || inst.id}`).replace(
            /^Visual Studio\s+/i,
            "",
          );
          if (!isVsVersionSupported(inst.version)) {
            step(`Visual Studio ${label}: unsupported version (skip)`);
            continue; // VS 2019 (16.x): manifest excludes it
          }
          const vsixInstaller = join(inst.path, "Common7", "IDE", "VSIXInstaller.exe");
          if (!existsSync(vsixInstaller)) {
            step(`Visual Studio ${label}: VSIXInstaller not found (skip)`);
            continue;
          }
          // per-instance skip: an instance that already has the current
          // version must not make every other instance skip too
          const installed = await installedVsCompanionVersion(inst);
          if (!force && installed !== null && installed === vsVsixVersion) {
            step(`Visual Studio ${label}: companion already current (${vsVsixVersion})`);
            continue;
          }
          try {
            // Per-instance install via /instanceIds — without it VSIXInstaller
            // targets only the newest instance. Per-user first (no elevation),
            // fall back to /a (all-users, may raise a UAC prompt) when the
            // per-user install FAILS or does not take effect: a stale
            // all-users copy in Common7\IDE\Extensions is not updated by a
            // per-user install, so the version check would keep reading the
            // old copy and reinstall at every pi start (the reported VS
            // "0.2.2 → 0.2.3" loop).
            const tryInstall = async (allUsers: boolean): Promise<void> => {
              await execFileAsync(
                vsixInstaller,
                allUsers
                  ? ["/q", "/a", `/instanceIds:${inst.id}`, vsVsix]
                  : ["/q", `/instanceIds:${inst.id}`, vsVsix],
                { timeout: 120_000, windowsHide: true },
              );
            };
            let error: string | undefined;
            try {
              step(`Visual Studio ${label}: installing ${vsVsixVersion}${installed === null ? "" : ` (${installed} → ${vsVsixVersion})`} (per-user)…`, true);
              await tryInstall(false);
            } catch (err1) {
              // per-user install failed outright → retry all-users
              step(`Visual Studio ${label}: per-user install failed — retrying all-users (UAC may prompt)…`, true);
              try {
                await tryInstall(true);
              } catch (err2) {
                error = `${describeExecError(err1)}; /a: ${describeExecError(err2)}`;
              }
            }
            if (!error) {
              // post-install verification: the highest-version-wins check
              // must now read the bundled version; if not, the per-user
              // install did not take effect → install all-users as well
              const after = await installedVsCompanionVersion(inst);
              if (after !== vsVsixVersion) {
                try {
                  await tryInstall(true);
                  const after2 = await installedVsCompanionVersion(inst);
                  if (after2 !== vsVsixVersion)
                    error = `installed version still ${after2 === null ? "missing" : `"${after2}"`} after install (bundled ${vsVsixVersion})`;
                } catch (err3) {
                  error = describeExecError(err3);
                }
              }
            }
            if (error) {
              step(`Visual Studio ${label}: error — ${error}`, true);
              notes.push({ target: "visualstudio", kind: "error", label, error });
            } else {
              step(
                installed === null
                  ? `Visual Studio ${label}: companion installed (${vsVsixVersion})`
                  : `Visual Studio ${label}: companion updated (${installed} → ${vsVsixVersion})`,
              );
              // update (not fresh install) → signal the open IDE to reload
              if (installed !== null) writeReloadSignal(vsVsixVersion);
              notes.push({
                target: "visualstudio",
                kind: installed === null ? "installed" : "updated",
                label,
                version: vsVsixVersion,
                ...(installed !== null ? { fromVersion: installed } : {}),
              });
            }
          } catch (err) {
            const desc = describeExecError(err);
            notes.push({
              target: "visualstudio",
              kind: "error",
              label,
              error: desc,
            });
          }
        }
      } catch (err) {
        notes.push({
          target: "visualstudio",
          kind: "error",
          error: describeExecError(err),
        });
      }
    }
  } else {
    step("Visual Studio: companion vsix not bundled (skip)");
  }

  return notes;
}

export type CompanionLocale = "it" | "en";

/**
 * Formats the notes into ready-to-surface messages. `prefix` is prepended to
 * every line (e.g. "pi-webview: " for the pi extension, "piw: " for the CLI).
 * The notes describe the ACTION only — the reload hints come separately from
 * `companionReloadHints`, so the final recap asks for a single reload per
 * IDE instead of one per installed extension.
 */
export function formatCompanionNotes(
  notes: CompanionNote[],
  locale: CompanionLocale,
  prefix: string,
): string[] {
  const it = locale === "it";
  return notes.map((n) => {
    // VS displayName already starts with "Visual Studio " — the notes/format
    // add the context themselves, so strip it defensively here too
    const label = (n.label ?? "").replace(/^Visual Studio\s+/i, "");
    switch (n.kind) {
      case "installed":
        return n.target === "vscode"
          ? it
            ? `${prefix}companion VS Code installato (${n.version}).`
            : `${prefix}companion installed in VS Code (${n.version}).`
          : it
            ? `${prefix}companion Visual Studio installato in ${label} (${n.version}).`
            : `${prefix}companion installed in Visual Studio (${label}, ${n.version}).`;
      case "updated":
        // reinstalled (force): the from/to versions match — avoid the
        // confusing "0.2.3 → 0.2.3"
        if (n.fromVersion === n.version) {
          return n.target === "vscode"
            ? it
              ? `${prefix}companion VS Code reinstallato (${n.version}).`
              : `${prefix}companion reinstalled in VS Code (${n.version}).`
            : it
              ? `${prefix}companion Visual Studio reinstallato in ${label} (${n.version}).`
              : `${prefix}companion reinstalled in Visual Studio (${label}, ${n.version}).`;
        }
        return n.target === "vscode"
          ? it
            ? `${prefix}companion VS Code aggiornato ${n.fromVersion} → ${n.version}.`
            : `${prefix}companion updated in VS Code (${n.fromVersion} → ${n.version}).`
          : it
            ? `${prefix}companion Visual Studio aggiornato in ${label} (${n.fromVersion} → ${n.version}).`
            : `${prefix}companion updated in Visual Studio (${label}, ${n.fromVersion} → ${n.version}).`;
      case "error":
        return n.target === "vscode"
          ? it
            ? `${prefix}installazione companion VS Code fallita: ${n.error}`
            : `${prefix}companion install failed in VS Code: ${n.error}`
          : it
            ? `${prefix}installazione companion Visual Studio fallita in ${label || "Visual Studio"}: ${n.error}`
            : `${prefix}companion install failed in Visual Studio (${label || "Visual Studio"}): ${n.error}`;
    }
  });
}

/**
 * Reload hints for the IDEs that received an install/update — ONE line per
 * target, never one per installed extension/instance: the final recap asks
 * the user to reload the window once per IDE, then it is done.
 */
export function companionReloadHints(
  notes: CompanionNote[],
  locale: CompanionLocale,
  prefix: string,
): string[] {
  const it = locale === "it";
  const targets = new Set(
    notes
      .filter((n) => n.kind === "installed" || n.kind === "updated")
      .map((n) => n.target),
  );
  const lines: string[] = [];
  if (targets.has("vscode"))
    lines.push(
      it
        ? `${prefix}ricarica la finestra di VS Code per attivare la webview.`
        : `${prefix}reload the VS Code window to activate the webview.`,
    );
  if (targets.has("visualstudio"))
    lines.push(
      it
        ? `${prefix}ricarica Visual Studio per attivare la webview.`
        : `${prefix}reload Visual Studio to activate the webview.`,
    );
  return lines;
}

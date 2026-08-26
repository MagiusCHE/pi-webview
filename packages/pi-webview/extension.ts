// pi-webview — pi extension (package distributed via `pi install`).
// At startup it does TWO ensures: 1) the VS Code companion (installs/updates
// from the bundled vsix if missing or outdated, idempotent) and 2) the `piw`
// link on PATH.
// `piw` in turn re-runs the VS Code companion ensure at startup.
// When pi runs inside the webview (env PI_WEBVIEW_COMPANION=1) the companion
// check still runs: it is the update channel for webview-only users (the
// package on disk is updated, the installed companion is not).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, posix, relative } from "node:path";
import { homedir } from "node:os";
import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { readVsixVersion } from "./lib/vsix-version.ts";

const execFileAsync = promisify(execFile);

const COMPANION_ID = "magiusche.pi-webview-ide";
const PKG_NAME = "@magiusche/pi-webview";
// `pi remove` wants the name WITH the npm: source prefix (like `pi install npm:…`)
const PKG_REF = `npm:${PKG_NAME}`;
const AUTO_INSTALL_ENV = "PI_WEBVIEW_AUTO_INSTALL";
const VSIX_REL = join("companion", "pi-webview-ide.vsix");

// Reload signal for the IDE (multi-IDE contract, docs/concept/0004):
// when the companion is UPDATED while the IDE is open, the window stays on
// the old version loaded in memory → we write the target version here;
// the IDE companion (running) reads it and asks for a reload.
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

type Notify = (message: string, kind: "info" | "warning" | "error") => void;

// Minimal pi API used by the extension (typed locally to avoid depending on
// @earendil-works/pi-coding-agent as a devDependency).
interface PiApi {
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => void | Promise<void>,
  ): void;
  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: (
        args: string,
        ctx: {
          ui: { notify: Notify; input: unknown; confirm: unknown; select: unknown };
        },
      ) => void | Promise<void>;
    },
  ): void;
  // slash commands available (for the registration dedupe — the check must
  // happen at session_start: during load getCommands is a stub that throws
  // "Extension runtime not initialized")
  getCommands(): { name: string; source?: string; sourceInfo?: SourceInfoLike }[];
  // all registered tools with their source metadata (extension path/package)
  getAllTools(): { name: string; sourceInfo?: SourceInfoLike }[];
}

// Source metadata attached by pi to tools/commands (source-info.ts): `source`
// is the package ("npm:…"/"git:…") or "local", baseDir the package root.
interface SourceInfoLike {
  path: string;
  source: string;
  baseDir?: string;
}

function detectIde(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.TERM_PROGRAM?.toLowerCase() === "windsurf") return "windsurf";
  if (env.TERM_PROGRAM?.toLowerCase() === "cursor") return "cursor";
  // same markers as pi-x-ide: TERM_PROGRAM=vscode is the standard marker of
  // the integrated terminal (without it the auto-install never triggered)
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return "vscode";
  if (
    env.VSCODE_PID ||
    env.VSCODE_CWD ||
    env.VSCODE_IPC_HOOK_CLI ||
    env.VSCODE_GIT_IPC_HANDLE
  ) {
    return "vscode";
  }
  return undefined;
}

// Runs the VS Code CLI portably: on Windows `code` is a `.cmd` file, which
// Node does not run with execFile → go through `cmd /c` with quoting of the
// paths (which on Windows often contain spaces).
function runCli(
  cli: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));
    return execFileAsync("cmd", ["/c", cli, ...quoted], {
      timeout,
      windowsHide: true,
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
async function installedCompanionVersion(cli: string): Promise<string | null> {
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

async function installCompanion(cli: string, vsixPath: string): Promise<void> {
  await runCli(cli, ["--install-extension", vsixPath, "--force"], 60_000);
}

// Path of the `piw` bin on the user's PATH (ex scripts/link-bin.mjs, removed):
// Unix → ~/.local/bin/piw (symlink), Windows → %APPDATA%\npm\piw.cmd.
// Dir override: PIW_BIN_DIR. No npm postinstall: the link is created by the
// extension at the first pi startup (ensurePiwBin).
function piwBinPaths(): { dir: string; link: string; target: string; isWindows: boolean } {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const target = join(moduleDir, "piw.js"); // dist/piw.js
  const isWindows = process.platform === "win32";
  const dir =
    process.env.PIW_BIN_DIR ??
    (isWindows
      ? process.env.APPDATA
        ? join(process.env.APPDATA, "npm")
        : ""
      : join(homedir(), ".local", "bin"));
  return {
    dir,
    link: dir ? join(dir, isWindows ? "piw.cmd" : "piw") : "",
    target,
    isWindows,
  };
}

// Creates the `piw` link on PATH if missing. NO npm postinstall (removed to
// avoid install scripts): the only creation/update path for the link is this
// ensure at pi startup. Best effort: never break pi startup because of a link.
// Idempotent: never touches user regular files.
function ensurePiwBin(): void {
  try {
    const { dir, link, target, isWindows } = piwBinPaths();
    if (!dir) return;
    if (isWindows) {
      // .cmd: create ONLY if missing (never overwrite a possible user file)
      if (existsSync(link)) return;
      mkdirSync(dir, { recursive: true });
      const content = `@echo off\r\nnode "${target.replace(/"/g, '\\"')}" %*\r\n`;
      writeFileSync(link, content);
      return;
    }
    // lstatSync as an EXISTENCE check (not existsSync): it sees even DANGLING
    // symlinks, which would otherwise never be replaced (and symlinkSync
    // would fail with EEXIST on the existing path)
    let st: ReturnType<typeof lstatSync> | null = null;
    try {
      st = lstatSync(link);
    } catch {
      st = null; // non esiste
    }
    if (st) {
      if (!st.isSymbolicLink()) return; // user regular file: do not touch
      const cur = readlinkSync(link);
      if (cur === target) return; // already our link
      rmSync(link); // link to another version/install path: replace
    }
    mkdirSync(dir, { recursive: true });
    symlinkSync(target, link);
  } catch {
    // best effort: never break startup because of a link
  }
}

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

// Removes the `piw` symlink from the user's PATH, ONLY if it points to this
// package's bin (never user regular files, never links pointing elsewhere).
// Replicated here because without an npm postinstall the link cleanup is
// entirely up to /pi-webview uninstall.
function unlinkPiwBin(): void {
  const { dir, link, target } = piwBinPaths();
  if (!dir) return;
  try {
    if (!existsSync(link)) return;
    if (!lstatSync(link).isSymbolicLink()) return; // user file: do not touch
    const cur = readlinkSync(link);
    if (cur !== target) return; // not our link
    rmSync(link);
  } catch {
    // best effort: never break the command because of a link
  }
}

// --- new-session banner (webview) ------------------------------------------
// The TUI shows the loaded-resources banner (Context/Skills/Extensions) at
// startup; in RPC mode (webview) that banner never renders, so we collect the
// same data and write it to a NON-session file (~/.pi/pi-webview/startup-info-
// <pid>.json) that the webview host reads on demand (getStartupInfo). The
// welcome banner is pure UI: it must NEVER be written to the session jsonl.
// Themes are TUI-only and skipped.

// Same candidates and order as pi's loadProjectContextFiles (resource-loader.js)
const CONTEXT_CANDIDATES = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];

function loadContextFileFromDir(dir: string): string | null {
  for (const name of CONTEXT_CANDIDATES) {
    const p = join(dir, name);
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      // unreadable entry: skip
    }
  }
  return null;
}

// Display path relative to the session cwd (like the TUI's formatContextPath):
// inside cwd → relative path; outside → home-relative with ~ (formatDisplayPath)
function displayPath(p: string, cwd: string): string {
  const rel = relative(cwd, p).replace(/\\/g, "/");
  if (rel && rel !== "." && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  const home = homedir().replace(/\\/g, "/");
  const abs = p.replace(/\\/g, "/");
  return abs.startsWith(home) ? `~${abs.slice(home.length)}` : abs;
}

// Path of the extension file relative to its package root (TUI getShortPath)
function shortPathWithinPackage(si: SourceInfoLike): string {
  const full = si.path.replace(/\\/g, "/");
  if (si.baseDir) {
    const rel = relative(si.baseDir, si.path).replace(/\\/g, "/");
    if (rel && rel !== "." && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  const m = full.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (m && m[2]) return m[2];
  return full;
}

// Compact extension label replicating the TUI (getCompactExtensionLabel):
// package source → "<package>[:<path within the package>]" (index files →
// just the package, or "package:dir"); local files → last path segment.
function compactExtensionLabel(si: SourceInfoLike): string {
  const source = si.source ?? "";
  const isPackage = source.startsWith("npm:") || source.startsWith("git:");
  const lastSegment = (p: string): string => {
    const segs = p.replace(/\\/g, "/").split("/").filter(Boolean);
    return segs[segs.length - 1] ?? p;
  };
  if (!isPackage) return lastSegment(si.path);
  const sourceLabel = source.startsWith("npm:") ? source.slice("npm:".length) : source;
  const shortPath = shortPathWithinPackage(si);
  const packagePath = shortPath.startsWith("extensions/")
    ? shortPath.slice("extensions/".length)
    : shortPath;
  const parsed = posix.parse(packagePath);
  if (parsed.name === "index") {
    return parsed.dir ? `${sourceLabel}:${parsed.dir}` : sourceLabel;
  }
  return `${sourceLabel}:${packagePath}`;
}

export default function (pi: PiApi): void {
  // path of the bundled companion vsix in the package: extension.js lives in
  // dist/, the vsix at package ROOT level (companion/…) → go up one level
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const vsixPath = join(moduleDir, "..", VSIX_REL);

  const autoInstall = (process.env[AUTO_INSTALL_ENV] ?? "1").trim().toLowerCase();
  const enabled = !["0", "false", "off", "none"].includes(autoInstall);

  let pendingNotify: string | null = null;

  // ensure 1/2 — VS Code companion: installs/updates if the installed version
  // does not match the bundled vsix. Runs at EVERY pi startup (idempotent): not
  // gated by IDE detection, so even webview-only users or pi launched from an
  // external terminal get the updated companion.
  // Disable with PI_WEBVIEW_AUTO_INSTALL=0.
  const tryAutoInstall = async (): Promise<void> => {
    if (!enabled) return;
    try {
      const installed = await installedCompanionVersion("code");
      const vsixVersion = readVsixVersion(vsixPath);
      if (installed !== null && vsixVersion !== undefined && installed === vsixVersion) {
        clearReloadSignal(); // already updated: no pending signal
        return; // already installed and updated
      }
      await installCompanion("code", vsixPath);
      // update (not fresh install) → signal the open IDE to reload
      if (installed !== null && vsixVersion !== undefined) {
        writeReloadSignal(vsixVersion);
      }
      pendingNotify =
        installed === null
          ? "pi-webview: companion installed in VS Code. Reload the window to activate the webview."
          : `pi-webview: companion updated to ${vsixVersion}. Reload the window to activate the webview.`;
    } catch (err) {
      // code CLI missing (ENOENT) → no VS Code: silent skip; other
      // errors must be notified
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        pendingNotify = `pi-webview: companion install failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  };

  // at load: ensure VS Code companion + ensure piw link (fire and forget)
  void tryAutoInstall();
  ensurePiwBin();

  // notify the user as soon as there is a UI context
  pi.on("session_start", (_event, ctx) => {
    const ui = (ctx as { ui?: { notify: Notify } }).ui;
    if (ui && pendingNotify) {
      ui.notify(pendingNotify, "info");
      pendingNotify = null;
    }
  });

  // --- new-session banner ----------------------------------------------------
  // Loaded resources (Context/Skills/Extensions, same data as the TUI startup
  // banner, Themes excluded) collected when a NEW session starts (or at startup
  // when the session is still empty) and written to a per-process file that the
  // webview host serves via getStartupInfo. NOT persisted in the session: the
  // banner is ephemeral UI, shown only while the chat is empty. The TUI shows
  // its own banner and must NOT receive ours (mode "tui" → skip).
  const collectStartupInfo = (cwd: string): {
    contextFiles: string[];
    skills: string[];
    extensions: string[];
  } => {
    // Context: global agent dir + AGENTS.md/CLAUDE.md from cwd up to the root
    const contextFiles: string[] = [];
    const seen = new Set<string>();
    const push = (p: string) => {
      if (seen.has(p)) return;
      seen.add(p);
      contextFiles.push(displayPath(p, cwd));
    };
    const globalFile = loadContextFileFromDir(join(homedir(), ".pi", "agent"));
    if (globalFile) push(globalFile);
    const ancestors: string[] = [];
    let dir = cwd;
    while (true) {
      const cf = loadContextFileFromDir(dir);
      if (cf && !seen.has(cf)) ancestors.push(cf);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const p of ancestors.reverse()) push(p);
    // Skills: slash commands with source "skill", names without the prefix
    let skills: string[] = [];
    try {
      skills = pi
        .getCommands()
        .filter((c) => c.source === "skill")
        .map((c) => c.name.replace(/^skill:/, ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // runtime not ready yet: the banner simply lacks the skills
    }
    // Extensions: tool + command source metadata, deduped by path, labeled
    // like the TUI startup list (package → "name:path", local → last segment)
    const extByPath = new Map<string, SourceInfoLike>();
    try {
      for (const t of pi.getAllTools()) {
        const si = t.sourceInfo;
        // "<builtin:…>"/"<inline:…>" are markers, not real extension files
        if (si?.path && !si.path.startsWith("<")) extByPath.set(si.path, si);
      }
      for (const c of pi.getCommands()) {
        const si = c.sourceInfo;
        if (c.source === "extension" && si?.path && !si.path.startsWith("<"))
          extByPath.set(si.path, si);
      }
    } catch {
      // runtime not ready yet: the banner simply lacks the extensions
    }
    const extensions = [...extByPath.values()]
      .map(compactExtensionLabel)
      .sort((a, b) => a.localeCompare(b));
    return { contextFiles, skills, extensions };
  };

  pi.on("session_start", (event, ctx) => {
    const e = event as { reason?: string };
    const c = ctx as {
      mode?: string;
      cwd?: string;
      sessionManager?: { getEntries?: () => { type?: string }[] };
    };
    // the webview is the only consumer: the TUI renders its own banner
    if (c.mode && c.mode !== "rpc") return;
    let hasMessages = false;
    try {
      hasMessages = (c.sessionManager?.getEntries?.() ?? []).some(
        (en) => en.type === "message",
      );
    } catch {
      // entries not ready yet: fall through to the empty check below
    }
    const isNew = e.reason === "new" || (e.reason === "startup" && !hasMessages);
    if (!isNew) return;
    const info = collectStartupInfo(c.cwd ?? process.cwd());
    if (
      info.contextFiles.length === 0 &&
      info.skills.length === 0 &&
      info.extensions.length === 0
    ) {
      return;
    }
    try {
      // NON-session file (one per pi process): the webview host reads it via
      // the getStartupInfo IDE request — never written to the session jsonl
      const dir = join(homedir(), ".pi", "pi-webview");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `startup-info-${process.pid}.json`);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(info));
      renameSync(tmp, file);
    } catch {
      // never break the session start because of the banner
    }
  });

  // compaction failed/cancelled (pi 0.84.3+): forward the REAL reason to
  // the UI (webview → chat status line; TUI → notification) — the event has
  // reason (aborted/error), retryState, source and errorMessage, which the
  // compaction_end event alone does not distinguish
  pi.on("session_compact_failed", (event, ctx) => {
    const ui = (ctx as { ui?: { notify: Notify } }).ui;
    if (!ui?.notify) return;
    const e = event as {
      reason?: string;
      source?: string;
      retryState?: string;
      errorMessage?: string;
    };
    const reason =
      e.reason === "aborted"
        ? "aborted"
        : e.reason === "error"
          ? "failed"
          : (e.reason ?? "failed");
    const source = e.source ? ` (${e.source})` : "";
    const retry = e.retryState ? ` — retry: ${e.retryState}` : "";
    const err = e.errorMessage ? `: ${e.errorMessage}` : "";
    ui.notify(
      `pi-webview: compaction ${reason}${source}${retry}${err}`,
      "warning",
    );
  });

  // deferred registration: getCommands() is a stub that THROWS during load
  // ("Extension runtime not initialized") → the dedupe can only happen after
  // the bind, at the first session_start (which rpc-mode waits for BEFORE
  // processing any command). If the same package is loaded twice (e.g.
  // installed npm + `pi -e` in dev) the second copy does NOT register — with
  // two registrations pi mangles the name to "pi-webview:1"/"pi-webview:2"
  // and the command is no longer invocable.
  const registerCommand = (): void => {
    pi.registerCommand("pi-webview", {
    description: "Manage the webview IDE integration (status, install, reinstall, uninstall)",
    handler: async (args, ctx) => {
      const [sub] = args.trim().split(/\s+/, 1);
      const notify = ctx.ui.notify;
      switch (sub || "status") {
        case "status": {
          const ide = detectIde();
          const companion = process.env.PI_WEBVIEW_COMPANION === "1";
          // presence of the piw link on PATH (diagnostics; lstat: sees even
          // dangling symlinks)
          const { dir, link } = piwBinPaths();
          let piw = "missing";
          try {
            if (dir && lstatSync(link).isSymbolicLink()) piw = "present";
          } catch {
            piw = "missing";
          }
          notify(
            `pi-webview: IDE detected = ${ide ?? "none"}; companion active = ${companion ? "yes (webview)" : "no"}; piw link = ${piw}`,
            "info",
          );
          return;
        }
        case "install":
        case "reinstall": {
          await installCompanion("code", vsixPath);
          notify(
            "pi-webview: companion installed. Reload the VS Code window.",
            "info",
          );
          return;
        }
        case "uninstall": {
          // 1) VS Code companion (if present — no gate on IDE detection)
          try {
            const before = await installedCompanionVersion("code");
            if (before === null) {
              notify("pi-webview: companion not installed in VS Code.", "info");
            } else {
              await runCli("code", ["--uninstall-extension", COMPANION_ID], 30_000);
              notify(
                `pi-webview: companion ${COMPANION_ID} removed from VS Code.`,
                "info",
              );
            }
          } catch (err) {
            notify(
              `pi-webview: companion uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
          }
          // 2) `piw` link from PATH (if it is ours)
          unlinkPiwBin();
          notify("pi-webview: piw binary link removed from PATH.", "info");
          // 3) remove the package from pi itself (pi remove npm:<name>)
          try {
            await runCli("pi", ["remove", PKG_REF], 60_000);
            notify(
              "pi-webview: package removed from pi. Restart pi to finish (reload the VS Code window if the companion was removed).",
              "info",
            );
          } catch (err) {
            notify(
              `pi-webview: pi remove failed (${err instanceof Error ? err.message : String(err)}). Run it manually: pi remove ${PKG_REF}`,
              "error",
            );
          }
          return;
        }
        default:
          notify("pi-webview: subcommands: status | install | reinstall | uninstall", "info");
      }
    },
    });
  };

  pi.on("session_start", () => {
    const already = pi.getCommands().some(
      (c) => c.name === "pi-webview" || c.name.startsWith("pi-webview:"),
    );
    if (!already) registerCommand();
  });
}

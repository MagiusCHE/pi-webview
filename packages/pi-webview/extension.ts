// pi-webview — pi extension (package distributed via `pi install`).
// At startup it does TWO ensures: 1) the IDE companions (VS Code + Visual
// Studio, installed/updated from the bundled vsixes when missing or
// outdated — centralized in src/bridge/companions.ts, the SAME module `piw`
// calls) and 2) the `piw` link on PATH.
// When pi runs inside the webview (env PI_WEBVIEW_COMPANION=1) the companion
// check still runs: it is the update channel for webview-only users (the
// package on disk is updated, the installed companion is not).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { homedir } from "node:os";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  COMPANION_ID,
  VSIX_ID,
  runCli,
  resolveCodeCli,
  installedCompanionVersion,
  installCompanion,
  vsCodeExtensionsDir,
  findVsCodeCompanionFolder,
  visualStudioInstances,
  isVsVersionSupported,
  ensureCompanions,
  formatCompanionNotes,
} from "../../src/bridge/companions.ts";

const execFileAsync = promisify(execFile);

const PKG_NAME = "@magiusche/pi-webview";
// Fallback ref (npm install). The REAL ref is resolved at runtime: a local
// install (`pi install ./packages/pi-webview`) is registered in settings.json
// as the relative PATH, not as `npm:<name>` — removing `npm:<name>` then
// fails with "No matching package found".
const PKG_REF = `npm:${PKG_NAME}`;

function samePath(a: string, b: string): boolean {
  const A = resolve(a);
  const B = resolve(b);
  return process.platform === "win32" ? A.toLowerCase() === B.toLowerCase() : A === B;
}

// Pure: given the `packages` list from ~/.pi/agent/settings.json and the
// agent dir (the base for relative path entries), returns the entry that
// refers to THIS package, or null. npm entries match by name (exact or
// versioned `name@tag`); path entries match by resolving them against the
// agent dir and comparing with the package root on disk.
export function findInstalledRef(
  packages: string[],
  packageRoot: string,
  agentDir: string,
): string | null {
  for (const entry of packages) {
    if (entry === PKG_REF || entry.startsWith(`${PKG_REF}@`)) return entry;
    if (entry.startsWith("npm:") || entry.startsWith("git:")) continue;
    if (samePath(resolve(agentDir, entry), packageRoot)) return entry;
  }
  return null;
}

function installedPackageRef(packageRoot: string): string {
  const agentDir = join(homedir(), ".pi", "agent");
  try {
    const raw = readFileSync(join(agentDir, "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as { packages?: unknown };
    const packages = Array.isArray(parsed.packages)
      ? parsed.packages.filter((p): p is string => typeof p === "string")
      : [];
    const ref = findInstalledRef(packages, packageRoot, agentDir);
    if (ref) return ref;
  } catch {
    // unreadable settings → fall back to the npm ref below
  }
  return PKG_REF;
}

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

// Companion check/install (VS Code + Visual Studio) is centralized in
// src/bridge/companions.ts — the SAME module `piw` uses. Everything below
// this point used to live here (runCli, resolveCodeCli, folder scan,
// vswhere/VSIXInstaller logic, ...); see the imports at the top.

// Path of the `piw` bin on the user's PATH (ex scripts/link-bin.mjs, removed):
// Unix → ~/.local/bin/piw (symlink), Windows → %APPDATA%\npm\piw.cmd.
// Dir override: PIW_BIN_DIR. No npm postinstall: the link is created by the
// extension at the first pi startup (ensurePiwBin).
function piwBinPaths(): {
  dir: string;
  link: string;
  target: string;
  isWindows: boolean;
} {
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

// Windows piw.cmd is a REGULAR file (not a symlink), so the symlink-only
// checks below are wrong there. Reads our generated .cmd shim back to the
// absolute path it invokes, or null when the file is missing or is NOT ours
// (a user's own piw.cmd that does not reference a dist/piw.js).
function readPiwCmdTarget(): string | null {
  const { link, isWindows } = piwBinPaths();
  if (!isWindows || !link) return null;
  try {
    const m = /node "([^"]*piw\.js)" %\*/.exec(readFileSync(link, "utf-8"));
    return m ? (m[1] ?? null) : null;
  } catch {
    return null;
  }
}

// Whether the piw shim on PATH points to THIS package's dist/piw.js.
// Windows: compare the path embedded in the .cmd; Unix: symlink readlink.
function piwPointsHere(): boolean {
  const { link, target, isWindows } = piwBinPaths();
  if (!link) return false;
  try {
    if (isWindows) {
      const cur = readPiwCmdTarget();
      return cur !== null && samePath(cur, target);
    }
    return lstatSync(link).isSymbolicLink() && readlinkSync(link) === target;
  } catch {
    return false;
  }
}

// Creates (or re-creates with `force`) the `piw` link on PATH. NO npm
// postinstall (removed to avoid install scripts): the only creation/update
// path for the link is this ensure at pi startup and the /piw install|reinstall
// command. Best effort: never break pi startup because of a link. Idempotent:
// never touches user regular files. Returns true when the link was created or
// rewritten, false when it was already in place or skipped.
function ensurePiwBin(force = false): boolean {
  try {
    const { dir, link, target, isWindows } = piwBinPaths();
    if (!dir) return false;
    if (isWindows) {
      // .cmd: create if missing, REWRITE if it is our stale shim pointing at
      // an old install path (or always with force). Never touch a user's own
      // piw.cmd.
      if (piwPointsHere() && !force) return false;
      if (existsSync(link) && readPiwCmdTarget() === null) return false; // user file
      mkdirSync(dir, { recursive: true });
      const content = `@echo off\r\nnode "${target.replace(/"/g, '\\"')}" %*\r\n`;
      writeFileSync(link, content);
      return true;
    }
    // lstatSync as an EXISTENCE check (not existsSync): it sees even DANGLING
    // symlinks, which would otherwise never be replaced (and symlinkSync
    // would fail with EEXIST on the existing path)
    let st: ReturnType<typeof lstatSync> | null = null;
    try {
      st = lstatSync(link);
    } catch {
      st = null; // missing
    }
    if (st) {
      if (!st.isSymbolicLink()) return false; // user regular file: do not touch
      const cur = readlinkSync(link);
      if (cur === target && !force) return false; // already our link
      rmSync(link); // stale or forced: replace
    }
    mkdirSync(dir, { recursive: true });
    symlinkSync(target, link);
    return true;
  } catch {
    // best effort: never break startup because of a link
    return false;
  }
}

// Removes the `piw` symlink from the user's PATH, ONLY if it points to this
// package's bin (never user regular files, never links pointing elsewhere).
// Replicated here because without an npm postinstall the link cleanup is
// entirely up to /piw uninstall.
function unlinkPiwBin(): void {
  const { dir, link, target, isWindows } = piwBinPaths();
  if (!dir) return;
  try {
    if (!existsSync(link)) return;
    if (isWindows) {
      if (readPiwCmdTarget() === null) return; // user file: do not touch
      rmSync(link);
      return;
    }
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
  // package root: extension.js lives in dist/, the companions vsix at
  // package ROOT level (companion/…) → go up one level
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  let pendingNotify: string | null = null;
  // last UI context seen: the auto-install may finish AFTER the first
  // session_start (RPC mode), when the pending-notify slot would otherwise
  // never flush — keep the context so the note is shown immediately
  let lastUi: { notify: Notify } | null = null;

  // ensure — IDE companions (VS Code + Visual Studio): installs/updates the
  // ones whose installed version does not match the bundled vsix. Centralized
  // in src/bridge/companions.ts (the SAME module `piw` calls); the returned
  // notes are surfaced via ui.notify here (pi.dev TUI + webview channels).
  // Runs at EVERY pi startup (idempotent), not gated by IDE detection.
  // Disable with PI_WEBVIEW_AUTO_INSTALL=0 (checked inside the module).
  const tryAutoInstall = async (): Promise<void> => {
    const notes = await ensureCompanions(packageRoot);
    const msgs = formatCompanionNotes(notes, "en", "pi-webview: ");
    if (msgs.length === 0) return; // silent skip (app absent / already current)
    const text = msgs.join(" ");
    if (lastUi) lastUi.notify(text, "info");
    else pendingNotify = text;
  };

  // at load: ensure the companions + the piw link (fire and forget)
  void tryAutoInstall();
  ensurePiwBin();

  // notify the user as soon as there is a UI context (or immediately, if a
  // session already started before the install finished)
  pi.on("session_start", (_event, ctx) => {
    const ui = (ctx as { ui?: { notify: Notify } }).ui;
    if (ui) lastUi = ui;
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
  const collectStartupInfo = (
    cwd: string,
  ): {
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
    ui.notify(`pi-webview: compaction ${reason}${source}${retry}${err}`, "warning");
  });

  // deferred registration: getCommands() is a stub that THROWS during load
  // ("Extension runtime not initialized") → the dedupe can only happen after
  // the bind, at the first session_start (which rpc-mode waits for BEFORE
  // processing any command). If the same package is loaded twice (e.g.
  // installed npm + `pi -e` in dev) the second copy does NOT register — with
  // two registrations pi mangles the name to "pi-webview:1"/"pi-webview:2"
  // and the command is no longer invocable.
  const registerCommand = (): void => {
    pi.registerCommand("piw", {
      description:
        "Manage the webview IDE integration (status, install, reinstall, uninstall)",
      handler: async (args, ctx) => {
        const [sub] = args.trim().split(/\s+/, 1);
        const notify = ctx.ui.notify;
        switch (sub || "status") {
          case "status": {
            const ide = detectIde();
            const companion = process.env.PI_WEBVIEW_COMPANION === "1";
            // presence of the piw shim on PATH, pointing at THIS package.
            // Windows piw.cmd is a regular file — not a symlink — so a plain
            // symlink check would always report "missing".
            const piw = piwPointsHere() ? "present" : "missing";
            notify(
              `pi-webview: IDE detected = ${ide ?? "none"}; companion active = ${companion ? "yes (webview)" : "no"}; piw link = ${piw}`,
              "info",
            );
            return;
          }
          case "install": {
            // idempotent: installs only the companions that are missing or
            // outdated (same check as the startup auto-install), and ensures
            // the `piw` launcher link exists
            const notes = await ensureCompanions(packageRoot);
            const piwLink = ensurePiwBin();
            const msgs = formatCompanionNotes(notes, "en", "pi-webview: ");
            const piwMsg = piwLink
              ? "pi-webview: piw launcher link created."
              : "pi-webview: piw launcher link already in place.";
            notify(msgs.length ? `${msgs.join(" ")} ${piwMsg}` : piwMsg, "info");
            return;
          }
          case "reinstall": {
            // force: reinstalls every companion even when the installed
            // version matches (repair of a broken install) and re-creates the
            // `piw` launcher link
            const notes = await ensureCompanions(packageRoot, { force: true });
            ensurePiwBin(true);
            const msgs = formatCompanionNotes(notes, "en", "pi-webview: ");
            notify(
              `${msgs.length ? `${msgs.join(" ")} ` : ""}pi-webview: piw launcher link re-created.`,
              "info",
            );
            return;
          }
          case "uninstall": {
            // 1) VS Code companion (if present — no gate on IDE detection)
            try {
              const cli = await resolveCodeCli();
              if (cli) {
                const before = await installedCompanionVersion(cli);
                if (before === null) {
                  notify("pi-webview: companion not installed in VS Code.", "info");
                } else {
                  await runCli(cli, ["--uninstall-extension", COMPANION_ID], 30_000);
                  notify(
                    `pi-webview: companion ${COMPANION_ID} removed from VS Code.`,
                    "info",
                  );
                }
              } else {
                // no code CLI: remove the companion folder directly (best effort)
                const folder = findVsCodeCompanionFolder(vsCodeExtensionsDir());
                if (folder === null) {
                  notify("pi-webview: companion not installed in VS Code.", "info");
                } else {
                  rmSync(folder, { recursive: true, force: true });
                  notify(
                    `pi-webview: companion ${COMPANION_ID} removed from VS Code.`,
                    "info",
                  );
                }
              }
            } catch (err) {
              notify(
                `pi-webview: companion uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
              );
            }
            // 1b) Visual Studio companion (Windows only): remove the package
            // by its id via VSIXInstaller /uninstall, one instance at a time
            // (best effort)
            try {
              const instances = await visualStudioInstances();
              let removedAny = false;
              for (const inst of instances) {
                if (!isVsVersionSupported(inst.version)) continue;
                const vsixInstaller = join(
                  inst.path,
                  "Common7",
                  "IDE",
                  "VSIXInstaller.exe",
                );
                if (!existsSync(vsixInstaller)) continue;
                try {
                  await execFileAsync(
                    vsixInstaller,
                    ["/q", `/instanceIds:${inst.id}`, `/uninstall:${VSIX_ID}`],
                    { timeout: 120_000, windowsHide: true },
                  );
                  removedAny = true;
                } catch {
                  // per-user uninstall failed: retry all-users
                  try {
                    await execFileAsync(
                      vsixInstaller,
                      ["/q", "/a", `/instanceIds:${inst.id}`, `/uninstall:${VSIX_ID}`],
                      { timeout: 120_000, windowsHide: true },
                    );
                    removedAny = true;
                  } catch {
                    // keep trying the other instances
                  }
                }
              }
              if (removedAny)
                notify("pi-webview: Visual Studio companion removed.", "info");
            } catch (err) {
              notify(
                `pi-webview: Visual Studio companion uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
              );
            }
            // 2) `piw` link from PATH (if it is ours)
            unlinkPiwBin();
            notify("pi-webview: piw binary link removed from PATH.", "info");
            // 3) remove the package from pi itself — the ref depends on how
            // it was installed (npm: entry or local path), so resolve it at
            // runtime instead of hardcoding the npm name
            const ref = installedPackageRef(packageRoot);
            try {
              await runCli("pi", ["remove", ref], 60_000);
              notify(
                "pi-webview: package removed from pi. Restart pi to finish (reload the VS Code window if the companion was removed).",
                "info",
              );
            } catch (err) {
              notify(
                `pi-webview: pi remove failed (${err instanceof Error ? err.message : String(err)}). Run it manually: pi remove ${ref}`,
                "error",
              );
            }
            return;
          }
          default:
            notify(
              "pi-webview: subcommands: status | install | reinstall | uninstall",
              "info",
            );
        }
      },
    });
  };

  pi.on("session_start", () => {
    const already = pi
      .getCommands()
      .some((c) => c.name === "piw" || c.name.startsWith("piw:"));
    if (!already) registerCommand();
  });
}

// Shared host between the sidebar (view) and the "new chat" panels: spawns
// `pi --mode rpc`, translates the IDE bridge protocol via postMessage and
// handles IDE requests (config, sessions, trust, attachments, selection).

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiProcess } from "../../bridge/pi-process.ts";
import { resolvePi, findPiFallback, findPiViaShell } from "../../bridge/spawn.ts";
import { samePath } from "../../ide/paths.ts";

// localization for host-side user-facing strings: no hardcoded Italian —
// every visible message respects the configured locale (config.json)
export function hostT(locale: string | undefined, it: string, en: string): string {
  return locale === "en" ? en : it;
}
export function hostLocale(): string | undefined {
  try {
    return new ConfigStore().get().locale;
  } catch {
    return undefined;
  }
}

// Deterministic companion log: `console.*` of extensions may NOT land in the
// VS Code exthost.log (it often goes only to the Developer Tools console /
// window.log). This file is always written, independent of VS Code log
// routing → on a user machine check ~/.pi/pi-webview/companion.log.
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB: reset only at session startup
export function logLine(msg: string): void {
  try {
    const dir = join(homedir(), ".pi", "pi-webview");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "companion.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // best effort: never break the host because of logging
  }
}

// called ONLY at session startup (activate): if the log already exceeds 2MB,
// reset it — the log must never grow unbounded across sessions
export function resetLogIfOversized(): void {
  try {
    const file = join(homedir(), ".pi", "pi-webview", "companion.log");
    if (statSync(file).size > MAX_LOG_BYTES) writeFileSync(file, "");
  } catch {
    // missing file: nothing to reset
  }
}

// stderr forwarding quota: keep the terminal parity without flooding the
// thread if pi prints a burst of lines
let stderrWindowStart = 0;
let stderrCount = 0;
function stderrAllowed(): boolean {
  const now = Date.now();
  if (now - stderrWindowStart > 5000) {
    stderrWindowStart = now;
    stderrCount = 0;
  }
  return stderrCount++ < 25;
}

// notification throttle + dedupe: pi can emit several notify OSC in a burst
let lastNotifyAt = 0;
let lastNotifyKey = "";
let hostNotifySeq = 0;
function notifyThrottled(key: string, fn: () => void): void {
  const now = Date.now();
  if (now - lastNotifyAt < 2000) return;
  if (key !== "" && key === lastNotifyKey && now - lastNotifyAt < 5000) return;
  lastNotifyAt = now;
  lastNotifyKey = key;
  fn();
}

// REAL desktop notification, not an in-app VS Code toast (which on Linux may
// never reach the OS): notify-send (Linux) / osascript (macOS), falling back
// to the VS Code toast when the tool is missing or fails. The "vscode"
// setting forces the in-app toast; "off" disables notifications entirely.
function nativeNotify(
  title: string,
  body: string,
  setting: "desktop" | "vscode" | "off",
  locale: string | undefined,
  iconPath: string | undefined,
): void {
  if (setting === "off") return;
  // turn-complete notification (extension title "π"): meaningful title,
  // body = the message only (no π leak). Localized via the config locale.
  const isTurnComplete = title === "π";
  const taskDone = locale === "en" ? "Task completed!" : "Task completato!";
  const summary = isTurnComplete ? `π pi-webview: ${taskDone}` : title || "pi";
  const toast = () => void vscode.window.showInformationMessage(`${summary}: ${body}`);
  if (setting === "vscode") {
    toast();
    return;
  }
  if (process.platform === "linux") {
    // turn-complete: header = the meaningful title, message as the body,
    // with the pi-webview icon (media/icon.png of the extension)
    const args = isTurnComplete ? ["-a", summary, body] : ["-a", "pi", summary, body];
    const withIcon = iconPath ? ["-i", iconPath, ...args] : args;
    execFile("notify-send", withIcon, { timeout: 5000 }, (err) => {
      if (err) toast(); // notify-send missing/failed: in-app toast as fallback
    });
    return;
  }
  if (process.platform === "darwin") {
    execFile(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(summary)}`,
      ],
      { timeout: 5000 },
      (err) => {
        if (err) toast();
      },
    );
    return;
  }
  toast();
}
import {
  ConfigStore,
  readCompactionSettings,
  readThinkingSettings,
} from "../../bridge/config.ts";
import { cliFlagArgs, fetchAvailableCliFlags } from "../../bridge/cli-flags.ts";
import {
  listSessions,
  forkSession,
  getSessionInfo,
  renameSessionFile,
  deleteSessionFile,
  readSessionCliFlags,
  writeSessionCliFlags,
  readSessionSettings,
  writeSessionSettings,
} from "../../bridge/sessions.ts";
import { getTrust, setTrust } from "../../bridge/trust.ts";
import { getPiSettings, setPiSettingFile } from "../../bridge/pi-settings.ts";
import { readStartupInfo } from "../../bridge/startup-info.ts";
import { saveAttachment, pathExists, attachFromPath } from "../../bridge/attachments.ts";
import { fetchProviderBalance } from "../../bridge/balance.ts";
import type {
  Frame,
  IdeEvent,
  IdeRequest,
  IdeResponse,
  RpcEvent,
  SessionListResult,
  SteerQueueItem,
  CliFlags,
  CliFlagInfo,
  SelectionRange,
} from "../../ide/protocol.ts";

export interface PiHostCallbacks {
  /** the webview changed the current session */
  onSessionChange: (path: string) => void;
  /** the webview requests a new chat in another panel */
  onNewChat: () => void;
}

export abstract class PiWebviewHost {
  protected pi: PiProcess | null = null;
  /** command line pi was launched with (for error messages) */
  protected piCommand = "";
  protected webview: vscode.Webview | null = null;
  protected config = new ConfigStore();
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  /** current session (updated via storeSession): needed when restarting pi */
  protected currentSessionPath: string | undefined;
  /** true during an intentional restart (setCliFlags): pi's exit is not a crash */
  private restarting = false;

  constructor(
    protected context: vscode.ExtensionContext,
    protected cb: PiHostCallbacks,
  ) {}

  /** pi launch CLI flags, persisted per workspace (settings block 3) */
  protected cliFlags(): CliFlags {
    return (
      this.context.workspaceState.get<CliFlags>("pi-webview.cliFlags") ?? {
        sessionControl: false,
      }
    );
  }

  /** restarts pi with the current launch options (setCliFlags): the webview
   *  gets connection_closed(reason restart) + pi_restarted to re-initialize
   *  without a reload (transparent); the current session is resumed with --session */
  protected restartPi(): void {
    const sessionPath = this.currentSessionPath;
    this.restarting = true;
    this.pi?.dispose();
    this.pi = null;
    this.post({
      channel: "rpc",
      payload: { type: "connection_closed", reason: "restart" } satisfies RpcEvent,
    });
    this.startPi(sessionPath);
    this.restarting = false;
    this.post({ channel: "rpc", payload: { type: "pi_restarted" } satisfies RpcEvent });
  }

  // --- launch CLI flags (settings block 3) ---------------------------------

  /** flags registered by pi + extensions, read from `pi --help` (section
   *  "Extension CLI Flags"); parsed once and cached for the host */
  private cachedFlags: CliFlagInfo[] | null = null;

  private async fetchAvailableFlags(): Promise<CliFlagInfo[]> {
    if (this.cachedFlags) return this.cachedFlags;
    const piCmd = resolvePi();
    if (!piCmd.found) return [];
    this.cachedFlags = await fetchAvailableCliFlags(piCmd.path ?? piCmd.command, logLine);
    return this.cachedFlags;
  }

  /** active values (flag → value) of the CURRENT session: read from the
   *  custom entry in the session jsonl file (per-session, not global) */
  protected cliFlagValues(): CliFlags {
    return readSessionCliFlags(this.currentSessionPath ?? "");
  }

  /** EFFECTIVE notifications mode for the CURRENT session: the per-session
   *  override first (saved inside the session jsonl), then the default
   *  (`notifications`, for NEW sessions) */
  protected effectiveNotifications(): "desktop" | "vscode" | "off" {
    const override = readSessionSettings(this.currentSessionPath ?? "").notifications;
    return override ?? this.config.get().notifications ?? "desktop";
  }

  protected workspace(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) return folder;
    // no workspace folder: fall back to the active document or cwd
    const doc = vscode.window.activeTextEditor?.document.uri;
    if (doc && doc.scheme === "file") {
      return vscode.workspace.getWorkspaceFolder(doc)?.uri.fsPath ?? process.cwd();
    }
    return process.cwd();
  }

  /** spawns pi --mode rpc; with sessionPath resumes that session (--session).
   *  piOverride: an already-resolved absolute path (e.g. found by the login
   *  shell probe) — skips the PATH/fallback search. */
  protected startPi(sessionPath?: string, piOverride?: string): void {
    logLine(`startPi session=${sessionPath ?? ""} pid=${process.pid}`);
    let piCmd = piOverride
      ? { command: piOverride, found: true, path: piOverride }
      : resolvePi();
    logLine(
      `resolvePi: found=${piCmd.found} command=${piCmd.command} path=${piCmd.path ?? ""} PATH=${(process.env.PATH ?? "").slice(0, 400)}`,
    );
    // extension host PATH may miss the shell-only dirs (desktop-launched VS
    // Code): before declaring "not found", check the well-known locations
    // (~/.local/bin, npm global, pnpm, homebrew…). If found, spawn the
    // absolute path directly.
    if (!piCmd.found && !piOverride) {
      const fallback = findPiFallback();
      if (fallback) {
        logLine(`fallback found: ${fallback.path}`);
        console.warn(
          "[pi-webview] 'pi' not in the extension host PATH, using fallback:",
          fallback.path,
        );
        piCmd = fallback;
      }
    }
    if (!piCmd.found) {
      // neither the host PATH nor the known dirs: probe the user's login
      // shell (nvm/bun/volta/custom prefixes are unknowable in advance).
      // Do NOT show the error yet: if the shell finds pi, pi starts and the
      // webview works; the error appears only if the probe fails too.
      logLine(`'pi' not in host PATH or fallback dirs — probing login shell`);
      void findPiViaShell().then((res) => {
        if (res && this.pi === null && this.webview) {
          logLine(`shell probe found: ${res.path}`);
          this.startPi(sessionPath, res.path ?? res.command);
        } else if (res) {
          logLine(`shell probe found but pi already running`);
        } else {
          logLine(`shell probe: not found — showing the error`);
          this.showPiMissing(piCmd);
        }
      });
      return;
    }
    // a session saved in ANOTHER workspace (header cwd ≠ open folder) must be
    // FORKED into the current workspace before resuming (like pi's
    // cross-folder resume): never resume a foreign session as-is.
    // The fork replicates header+history in the active project folder.
    if (sessionPath && existsSync(sessionPath)) {
      try {
        const info = getSessionInfo(sessionPath);
        const ws = this.workspace();
        if (info.cwd && ws && !samePath(info.cwd, ws)) {
          const forked = forkSession(sessionPath, ws);
          sessionPath = forked.path;
        }
      } catch (err) {
        // fork failed: keep the original session but warn (the UI would
        // show a session outside the workspace: better to flag it)
        const locale = this.config.get().locale;
        void vscode.window.showWarningMessage(
          `${hostT(locale, "pi-webview: impossibile riprendere la sessione nel workspace corrente", "pi-webview: cannot resume the session in the current workspace")}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const sessionArgs =
      sessionPath && existsSync(sessionPath) ? ["--session", sessionPath] : [];
    // when resuming a session, it (possibly forked) becomes the current one
    if (sessionArgs.length > 0) this.currentSessionPath = sessionPath;
    // CLI flags from settings (block 3: e.g. --session-control)
    const activeCliFlagArgs = cliFlagArgs(this.cliFlagValues());
    // actual command line used to launch pi (for error messages: suggested
    // to the user to verify pi works from a terminal)
    this.piCommand = [
      piCmd.command,
      "--mode",
      "rpc",
      ...sessionArgs,
      ...activeCliFlagArgs,
    ].join(" ");

    this.pi = new PiProcess(
      piCmd.command,
      {
        onEvent: (evt) => {
          // ALL extension_ui_request (select/confirm/input/editor/notify/
          // setStatus/…) are forwarded TO THE WEBVIEW: modals appear in the
          // sidebar where the user is looking, not as native VS Code dialogs
          // on top of the editor (easy to miss → looks like "not working").
          // The webview replies with extension_ui_response, which handleFrame
          // delivers to pi. Native dialogs were why ask_user seemed randomly
          // "cancelled".
          this.post({ channel: "rpc", payload: evt as RpcEvent });
        },
        onStderr: (line) => {
          console.warn("[pi]", line);
          // debug: raw stderr → companion.log (does the OSC 777 arrive here?)
          logLine(`stderr: ${line.slice(0, 160)}`);
          // terminal parity: forward pi stderr to the webview (capped)
          if (stderrAllowed()) {
            this.post({ channel: "rpc", payload: { type: "pi_stderr", line } });
          }
        },
        onNotify: ({ title, body }) => {
          // OSC 777 notify from an extension: surface it, but "Ready for
          // input" (emitted by pi at startup) is noise — log only.
          if (title === "Ready for input" || title === "Ready") {
            logLine(`notify ignored (noise) title=${title}`);
            return;
          }
          const setting = this.effectiveNotifications();
          if (setting === "off") {
            logLine(`notify off (setting) title=${title}`);
            return;
          }
          if (!vscode.window.state.focused) {
            logLine(`notify shown #${++hostNotifySeq} title=${title} setting=${setting}`);
            notifyThrottled(`${title}:${body}`, () =>
              nativeNotify(
                title,
                body,
                setting,
                this.config.get().locale,
                vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png")
                  .fsPath,
              ),
            );
          } else {
            logLine(`notify skipped (window focused) title=${title}`);
          }
        },
        onExit: (_code, _signal, error) => {
          logLine(`pi exited error=${error ?? "none"}`);
          if (this.restarting) return; // intentional restart: not a crash
          // asks the user to verify pi from a terminal with the SAME command
          // line used here, so the real error becomes visible
          const locale = this.config.get().locale;
          const hint = hostT(
            locale,
            `Verifica che pi funzioni lanciando \`${this.piCommand}\` dal terminale.`,
            `Verify pi works by running \`${this.piCommand}\` from a terminal.`,
          );
          void vscode.window.showWarningMessage(
            error
              ? hostT(
                  locale,
                  `pi non è partito (${error}). ${hint}`,
                  `pi failed to start (${error}). ${hint}`,
                )
              : hostT(
                  locale,
                  `pi è terminato in modo inatteso. ${hint}`,
                  `pi terminated unexpectedly. ${hint}`,
                ),
          );
          // notifies the webview: unlocks the UI (working/compact) and shows the error
          this.post({
            channel: "rpc",
            payload: { type: "connection_closed", command: this.piCommand, error },
          });
        },
      },
      // marker: the pi-webview extension (pi side) knows it is already integrated (no re-install).
      // cwd = VS Code workspace folder: without it, pi uses the extension
      // host cwd (often another workspace) → the agent answers the wrong
      // directory even if the session belongs to another folder
      {
        env: { ...process.env, PI_WEBVIEW_COMPANION: "1" },
        args: [...sessionArgs, ...activeCliFlagArgs],
        ...(this.workspace() ? { cwd: this.workspace() } : {}),
      },
    );
    this.pi.start();
    logLine(`spawning: ${this.piCommand}`);
  }

  /** real "pi not found" error, shown only after PATH + dirs + shell probe all miss */
  private showPiMissing(piCmd: { command: string }): void {
    const locale = this.config.get().locale;
    const install = "npm install -g @earendil-works/pi-coding-agent";
    const hint = hostT(
      locale,
      `Se da terminale \`command -v pi\` funziona, il problema è il PATH: VS Code avviato da icona/desktop non eredita la shell. Avvialo dal terminale o aggiungi la cartella di pi al PATH. Altrimenti installalo con \`${install}\``,
      `If \`command -v pi\` works in a terminal, the issue is the PATH: VS Code launched from an icon/desktop does not inherit the shell. Launch it from a terminal or add the pi folder to the PATH. Otherwise install it with \`${install}\``,
    );
    void vscode.window.showErrorMessage(
      hostT(
        locale,
        `Comando '${piCmd.command}' non trovato nel PATH di VS Code. ${hint}`,
        `Command '${piCmd.command}' not found in the VS Code PATH. ${hint}`,
      ),
    );
    this.post({
      channel: "rpc",
      payload: {
        type: "connection_closed",
        command: `${piCmd.command} --mode rpc`,
        error: `'${piCmd.command}' non trovato nel PATH di VS Code (il terminale può avere un PATH diverso)`,
      },
    });
  }

  protected post(frame: Frame): void {
    this.webview?.postMessage(frame);
  }

  dispose(): void {
    logLine("dispose");
    this.pi?.dispose();
    this.pi = null;
  }

  private respond(
    id: string | undefined,
    ok: boolean,
    data?: unknown,
    error?: string,
  ): void {
    const res: IdeResponse = ok
      ? { id: id ?? "", ok, data }
      : { id: id ?? "", ok, error };
    this.post({ channel: "ide", payload: res });
  }

  protected async handleFrame(frame: Frame): Promise<void> {
    if (frame.channel === "rpc") {
      this.pi?.send(frame.payload);
      return;
    }
    const req = frame.payload as IdeRequest;
    switch (req.type) {
      case "getConfig":
        this.respond(req.id, true, this.config.get());
        return;
      case "setConfig":
        this.config.patch(req.patch);
        this.respond(req.id, true, this.config.get());
        return;
      case "storeSession":
        this.cb.onSessionChange(req.path);
        // track the current session: needed for restart (Apply CLI flags)
        this.currentSessionPath = req.path;
        this.respond(req.id, true);
        return;
      case "openNewChat":
        this.cb.onNewChat();
        this.respond(req.id, true);
        return;
      case "getBalance":
        void fetchProviderBalance(req.provider).then((b) =>
          this.respond(req.id, true, b ?? null),
        );
        return;
      case "getCompactionSettings":
        this.respond(req.id, true, readCompactionSettings());
        return;
      case "getSettings": {
        const ws = this.workspace();
        this.respond(
          req.id,
          true,
          getPiSettings(
            {
              workspace: ws,
              workspaceTrusted: ws ? getTrust(ws).status === "trusted" : undefined,
            },
            req.key,
          ),
        );
        return;
      }
      case "setSetting": {
        const ws = this.workspace();
        const trusted = ws ? getTrust(ws).status === "trusted" : undefined;
        const res = setPiSettingFile(req.key, req.value, {
          workspace: ws,
          workspaceTrusted: trusted,
          scope: req.scope,
        });
        if (!res.ok) {
          this.respond(req.id, false, res.error ?? "set_setting failed");
          return;
        }
        // propagation "restart": write done → restart pi transparently
        // (connection_closed reason restart + pi_restarted → re-init)
        this.respond(req.id, true, { needsRestart: true });
        this.restartPi();
        return;
      }
      case "getThinkingSettings":
        this.respond(req.id, true, readThinkingSettings(this.workspace()));
        return;
      case "listSessions":
        this.respond(req.id, true, {
          sessions: listSessions(undefined, req.workspace),
          workspace: this.workspace(),
        } satisfies SessionListResult);
        return;
      case "getWorkspace":
        this.respond(req.id, true, { workspace: this.workspace() });
        return;
      case "getVersion":
        // VS Code addon version (the companion itself)
        this.respond(req.id, true, {
          source: "vscode",
          version:
            vscode.extensions.getExtension("magiusche.pi-webview-ide")?.packageJSON
              ?.version ?? null,
        });
        return;
      case "getCliFlags":
        // available flags (pi + extensions, from `pi --help`) + active values
        void this.fetchAvailableFlags().then((available) =>
          this.respond(req.id, true, {
            available,
            values: readSessionCliFlags(req.sessionPath ?? this.currentSessionPath ?? ""),
          }),
        );
        return;
      case "setCliFlags": {
        // apply: write to the session (custom entry in the jsonl) + restart pi
        // with the new command line (the webview already did dequeue+stop
        // if there was an in-flight run)
        const next: CliFlags = req.flags ?? {};
        const sessionPath = req.sessionPath ?? this.currentSessionPath ?? "";
        writeSessionCliFlags(sessionPath, next);
        if (sessionPath) this.currentSessionPath = sessionPath;
        this.respond(req.id, true, { flags: next });
        this.restartPi();
        return;
      }
      case "getSessionSettings":
        this.respond(
          req.id,
          true,
          readSessionSettings(req.sessionPath ?? this.currentSessionPath ?? ""),
        );
        return;
      case "setSessionSettings": {
        // write INSIDE the session file (custom entry): no global config keys
        const path = req.sessionPath ?? this.currentSessionPath ?? "";
        writeSessionSettings(path, req.settings ?? {});
        this.respond(req.id, true, readSessionSettings(path));
        return;
      }
      case "getStartupInfo":
        // new-session welcome banner: NON-persistent (per-process file written
        // by the pi-side extension at session_start — never in the session jsonl)
        this.respond(req.id, true, { info: readStartupInfo(this.pi?.pid) });
        return;
      case "forkSession":
        try {
          const ws = this.workspace();
          if (!ws) throw new Error("nessuna cartella di lavoro aperta");
          this.respond(req.id, true, forkSession(req.sourcePath, ws));
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "getSessionInfo":
        try {
          this.respond(req.id, true, getSessionInfo(req.path));
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "renameSession":
        try {
          renameSessionFile(req.path, req.name);
          this.respond(req.id, true, { path: req.path, name: req.name });
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "deleteSession":
        try {
          deleteSessionFile(req.path);
          // removes the deleted session from saved chats (workspaceState).
          // NOTE: NO import from panels.ts here (circular host↔panels import:
          // would break extension activation) → update the state inline.
          const CHATS_KEY = "pi-webview.chats";
          const chats = this.context.workspaceState.get<string[]>(CHATS_KEY);
          if (chats) {
            const next = chats.filter((p) => p !== req.path);
            if (next.length !== chats.length) {
              void this.context.workspaceState.update(
                CHATS_KEY,
                next.length ? next : null,
              );
            }
          }
          this.respond(req.id, true);
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "storeSteerQueue":
        // steering queue persisted per workspace: survives reload
        void this.context.workspaceState.update(
          "pi-webview.steerQueue",
          req.items.length ? req.items : null,
        );
        this.respond(req.id, true);
        return;
      case "getSteerQueue":
        this.respond(req.id, true, {
          items:
            this.context.workspaceState.get<SteerQueueItem[]>("pi-webview.steerQueue") ??
            [],
        });
        return;
      case "notifyDesktop":
        // turn-complete notification requested by the webview (VS Code path):
        // real desktop notification via notify-send/osascript
        logLine(`notifyDesktop title=${req.title}`);
        notifyThrottled(`${req.title}:${req.body}`, () =>
          nativeNotify(
            req.title,
            req.body,
            this.effectiveNotifications(),
            this.config.get().locale,
            vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png").fsPath,
          ),
        );
        this.respond(req.id, true);
        return;
      case "getTrust": {
        const ws = this.workspace() ?? "";
        this.respond(req.id, true, getTrust(ws));
        return;
      }
      case "setTrust": {
        const ws = this.workspace() ?? "";
        this.respond(req.id, true, setTrust(ws, req.status));
        return;
      }
      case "saveAttachment":
        try {
          this.respond(
            req.id,
            true,
            saveAttachment(req.name, req.mimeType, req.dataBase64),
          );
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "pickFile":
        // attach via the native VS Code file dialog: reliable fallback when
        // the drag & drop into the webview is swallowed by the workbench
        {
          const locale = this.config.get().locale;
          void vscode.window
            .showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: true,
              openLabel: hostT(locale, "Allega", "Attach"),
              title: hostT(
                locale,
                "Allega file alla sessione",
                "Attach files to the session",
              ),
            })
            .then(
              (uris) => {
                this.respond(req.id, true, {
                  paths: (uris ?? []).map((u) => u.fsPath),
                });
              },
              (err) =>
                this.respond(
                  req.id,
                  false,
                  undefined,
                  err instanceof Error ? err.message : String(err),
                ),
            );
        }
        return;
      case "attachPath":
        try {
          this.respond(req.id, true, attachFromPath(req.path));
        } catch (err) {
          this.respond(
            req.id,
            false,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      case "pathExists":
        this.respond(req.id, true, { exists: pathExists(req.path) });
        return;
      case "attachSelection":
        this.postSelection();
        this.respond(req.id, true);
        return;
      default:
        this.respond(
          req.id,
          false,
          undefined,
          `richiesta IDE non supportata: ${req.type}`,
        );
    }
  }

  // --- editor selection -----------------------------------------------------

  /** last known selection (persists even when focus goes to the webview
   *  or the terminal: the selection must NOT disappear when clicking the input) */
  private lastSelection: {
    filePath?: string;
    workspaceFolder?: string;
    ranges: SelectionRange[];
  } | null = null;

  postSelection(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      // no active text editor (focus on webview/terminal/panel):
      // DO NOT clear — re-post the last known selection (if any). VS Code
      // treats the WebviewPanel as an "active editor" → without this, focus
      // on the webview input would cancel the attached selection.
      if (this.lastSelection) {
        this.post({
          channel: "ide",
          payload: {
            type: "selection_changed",
            ...this.lastSelection,
          } satisfies IdeEvent,
        });
        return;
      }
      this.post({
        channel: "ide",
        payload: {
          type: "selection_cleared",
          reason: "no-active-file",
        } satisfies IdeEvent,
      });
      return;
    }
    const doc = editor.document;
    const ranges = editor.selections
      .filter((s) => !s.isEmpty)
      .map((s) => ({
        text: doc.getText(s),
        selection: {
          start: { line: s.start.line, character: s.start.character },
          end: { line: s.end.line, character: s.end.character },
        },
      }));
    if (ranges.length > 0) {
      // selection present: remember it (for the "webview focus" case)
      this.lastSelection = {
        filePath: doc.uri.fsPath,
        workspaceFolder: vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath,
        ranges,
      };
      this.post({
        channel: "ide",
        payload: {
          type: "selection_changed",
          ...this.lastSelection,
        } satisfies IdeEvent,
      });
      return;
    }
    // EMPTY selection in the active file: the user really deselected
    this.lastSelection = null;
    this.post({
      channel: "ide",
      payload: {
        type: "selection_cleared",
        reason: "empty-selection",
      } satisfies IdeEvent,
    });
  }

  /** editor selection → this webview (debounced) */
  protected attachSelectionListener(): void {
    const pushSelection = () => {
      if (this.selectionTimer) clearTimeout(this.selectionTimer);
      this.selectionTimer = setTimeout(() => this.postSelection(), 150);
    };
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(pushSelection),
      vscode.window.onDidChangeTextEditorSelection(pushSelection),
    );
    this.postSelection();
  }

  // --- webview HTML (same bundle for view and panels) ----------------------

  protected webviewHtml(webview: vscode.Webview): string {
    const webDir = vscode.Uri.joinPath(this.context.extensionUri, "dist", "web");
    const indexPath = vscode.Uri.joinPath(webDir, "index.html");
    let html = readFileSync(indexPath.fsPath, "utf-8");
    const root = webview.asWebviewUri(webDir);
    html = html.replace(/src="\/assets\//g, `src="${root}/assets/`);
    html = html.replace(/href="\/assets\//g, `href="${root}/assets/`);
    html = html.replace(/href="\/style\.css"/g, `href="${root}/style.css"`);
    html = html.replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src ${webview.cspSource}; font-src ${webview.cspSource};">`,
    );
    return html;
  }
}

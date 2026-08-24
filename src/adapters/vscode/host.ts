// Host condiviso tra sidebar (view) e pannelli "nuova chat": spawna
// `pi --mode rpc`, traduce l'IDE bridge protocol via postMessage e gestisce
// le richieste IDE (config, sessioni, trust, allegati, selezione).

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { PiProcess } from "../../bridge/pi-process.ts";
import { resolvePi, checkBashOnWindows } from "../../bridge/spawn.ts";

const execFileAsync = promisify(execFile);
import { ConfigStore, readCompactionSettings } from "../../bridge/config.ts";
import {
  listSessions,
  forkSession,
  getSessionInfo,
  renameSessionFile,
  deleteSessionFile,
  readSessionCliFlags,
  writeSessionCliFlags,
} from "../../bridge/sessions.ts";
import { getTrust, setTrust } from "../../bridge/trust.ts";
import { saveAttachment, pathExists } from "../../bridge/attachments.ts";
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
  /** la webview ha cambiato sessione corrente */
  onSessionChange: (path: string) => void;
  /** la webview chiede una nuova chat in un altro pannello */
  onNewChat: () => void;
}

export abstract class PiWebviewHost {
  protected pi: PiProcess | null = null;
  protected webview: vscode.Webview | null = null;
  protected config = new ConfigStore();
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  /** sessione corrente (aggiornata via storeSession): serve al riavvio di pi */
  protected currentSessionPath: string | undefined;
  /** true durante un riavvio voluto (setCliFlags): l'exit di pi non è un crash */
  private restarting = false;

  constructor(
    protected context: vscode.ExtensionContext,
    protected cb: PiHostCallbacks,
  ) {}

  /** flag CLI di lancio di pi, persistiti per workspace (blocco 3 settings) */
  protected cliFlags(): CliFlags {
    return (
      this.context.workspaceState.get<CliFlags>("pi-webview.cliFlags") ?? {
        sessionControl: false,
      }
    );
  }

  /** riavvia pi con le opzioni di lancio correnti (setCliFlags): la webview
   *  riceve connection_closed(reason restart) + pi_restarted per re-inizializzarsi
   *  senza reload (trasparente); la sessione corrente viene ripresa con --session */
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

  // --- flag CLI di lancio (blocco 3 settings) --------------------------------

  /** flag registrati da pi + estensioni, letti da `pi --help` (sezione
   *  "Extension CLI Flags"); parsati una volta e cacheati per host */
  private cachedFlags: CliFlagInfo[] | null = null;

  private async fetchAvailableFlags(): Promise<CliFlagInfo[]> {
    if (this.cachedFlags) return this.cachedFlags;
    try {
      const piCmd = resolvePi();
      if (!piCmd.found) return [];
      const { stdout } = await execFileAsync(
        piCmd.command,
        ["--help"],
        { timeout: 15_000 },
      );
      const out = stdout.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI
      const section = out.split("Extension CLI Flags:")[1]?.split(/\n\s*\n/)[0] ?? "";
      const flags: CliFlagInfo[] = [];
      for (const line of section.split(/\r?\n/)) {
        const m = /^\s*--([a-z0-9-]+)( <value>)?\s+(.+)$/.exec(line.trim());
        if (m) {
          flags.push({
            name: m[1] ?? "",
            type: m[2] ? "string" : "boolean",
            description: m[3] ?? "",
          });
        }
      }
      this.cachedFlags = flags;
      return flags;
    } catch {
      return [];
    }
  }

  /** valori attivi (flag → valore) della SESSIONE CORRENTE: letti dalla
   *  entry custom nel file jsonl della sessione (per-sessione, non globali) */
  protected cliFlagValues(): CliFlags {
    return readSessionCliFlags(this.currentSessionPath ?? "");
  }

  /** argomenti CLI per i flag attivi (es. --session-control, --preset <v>) */
  private cliFlagArgs(): string[] {
    const args: string[] = [];
    for (const [name, value] of Object.entries(this.cliFlagValues())) {
      if (value === true) args.push(`--${name}`);
      else if (typeof value === "string" && value !== "") {
        args.push(`--${name}`, value);
      }
    }
    return args;
  }

  protected workspace(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) return folder;
    // nessuna cartella di lavoro: fallback sul documento attivo o cwd
    const doc = vscode.window.activeTextEditor?.document.uri;
    if (doc && doc.scheme === "file") {
      return vscode.workspace.getWorkspaceFolder(doc)?.uri.fsPath ?? process.cwd();
    }
    return process.cwd();
  }

  /** spawna pi --mode rpc; con sessionPath riprende quella sessione (--session) */
  protected startPi(sessionPath?: string): void {
    const piCmd = resolvePi();
    if (!piCmd.found) {
      void vscode.window.showErrorMessage(
        `Comando '${piCmd.command}' non trovato: installa pi con npm install -g @earendil-works/pi-coding-agent`,
      );
      return;
    }
    const bashWarning = checkBashOnWindows();
    if (bashWarning) void vscode.window.showWarningMessage(bashWarning);

    // una sessione salvata di un ALTRO workspace (header cwd ≠ cartella aperta)
    // va FORKATA nel workspace corrente prima del resume (come il resume
    // cross-folder di pi): mai riprendere una sessione estranea così com'è.
    // Il fork replica header+cronologia nella cartella del progetto attivo.
    if (sessionPath && existsSync(sessionPath)) {
      try {
        const info = getSessionInfo(sessionPath);
        const ws = this.workspace();
        if (info.cwd && ws && info.cwd !== ws) {
          const forked = forkSession(sessionPath, ws);
          sessionPath = forked.path;
        }
      } catch (err) {
        // fork non riuscito: la sessione originale resta, ma avvisa (la UI
        // mostrerebbe una sessione fuori workspace: meglio segnalarlo)
        void vscode.window.showWarningMessage(
          `pi-webview: impossibile riprendere la sessione nel workspace corrente: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const sessionArgs =
      sessionPath && existsSync(sessionPath) ? ["--session", sessionPath] : [];
    // se si riprende una sessione, è quella (eventualmente forkata) la corrente
    if (sessionArgs.length > 0) this.currentSessionPath = sessionPath;
    // flag CLI dalle impostazioni (blocco 3: es. --session-control)
    const cliFlagArgs = this.cliFlagArgs();

    this.pi = new PiProcess(
      piCmd.command,
      {
        onEvent: (evt) => {
          // TUTTI gli extension_ui_request (select/confirm/input/editor/notify/
          // setStatus/…) vengono inoltrati ALLA WEBVIEW: i modali compaiono
          // nella sidebar dove guarda l'utente, non come dialoghi nativi VS
          // Code in cima all'editor (facili da ignorare → sembra "non
          // funzioni"). La webview risponde con extension_ui_response, che
          // handleFrame fa arrivare a pi. I dialoghi nativi erano il motivo
          // per cui ask_user sembrava "cancellato" a caso.
          this.post({ channel: "rpc", payload: evt as RpcEvent });
        },
        onStderr: (line) => console.warn("[pi]", line),
        onExit: () => {
          if (this.restarting) return; // riavvio voluto: non è un crash
          void vscode.window.showWarningMessage("pi è terminato in modo inatteso");
          // avvisa la webview: sblocca la UI (working/compact) e mostra l'errore
          this.post({ channel: "rpc", payload: { type: "connection_closed" } });
        },
      },
      // marker: l'estensione pi-webview (lato pi) sa che è già integrato (niente re-install).
      // cwd = cartella di lavoro VS Code: senza, pi usa il cwd dell'extension
      // host (spesso di un'altra workspace) → l'agente risponde la directory
      // sbagliata anche se la sessione è di un'altra cartella
      {
        env: { ...process.env, PI_WEBVIEW_COMPANION: "1" },
        args: [...sessionArgs, ...cliFlagArgs],
        ...(this.workspace() ? { cwd: this.workspace() } : {}),
      },
    );
    this.pi.start();
  }

  protected post(frame: Frame): void {
    this.webview?.postMessage(frame);
  }

  dispose(): void {
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
        // traccia la sessione corrente: serve al riavvio (Applica CLI flags)
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
        // versione dell'addon VS Code (il companion stesso)
        this.respond(req.id, true, {
          source: "vscode",
          version:
            vscode.extensions
              .getExtension("magiusche.pi-webview-ide")
              ?.packageJSON?.version ?? null,
        });
        return;
      case "getCliFlags":
        // flag disponibili (pi + estensioni, da `pi --help`) + valori attivi
        void this.fetchAvailableFlags().then((available) =>
          this.respond(req.id, true, {
            available,
            values: this.cliFlagValues(),
          }),
        );
        return;
      case "setCliFlags": {
        // applica: scrive nella sessione (entry custom nel jsonl) + riavvia pi
        // con la nuova riga di comando (la webview ha già fatto dequeue+stop
        // se c'era un'elaborazione)
        const next: CliFlags = req.flags ?? {};
        writeSessionCliFlags(this.currentSessionPath ?? "", next);
        this.respond(req.id, true, { flags: next });
        this.restartPi();
        return;
      }
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
          // toglie la sessione eliminata dalle chat salvate (workspaceState).
          // NB: NIENTE import da panels.ts qui (import circolare host↔panels:
          // romperebbe l'attivazione dell'estensione) → aggiorna lo state inline.
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
        // coda stearing persistita per workspace: sopravvive al reload
        void this.context.workspaceState.update(
          "pi-webview.steerQueue",
          req.items.length ? req.items : null,
        );
        this.respond(req.id, true);
        return;
      case "getSteerQueue":
        this.respond(req.id, true, {
          items: this.context.workspaceState.get<SteerQueueItem[]>(
            "pi-webview.steerQueue",
          ) ?? [],
        });
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

  // --- selezione editor ------------------------------------------------------

  /** ultima selezione nota (persiste anche quando il focus va sulla webview
   *  o sul terminale: la selezione NON deve sparire cliccando nell'input) */
  private lastSelection: {
    filePath?: string;
    workspaceFolder?: string;
    ranges: SelectionRange[];
  } | null = null;

  postSelection(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      // nessun editor di testo attivo (focus su webview/terminale/pannello):
      // NON azzerare — ri-pubblica l'ultima selezione nota (se c'è). VS Code
      // tratta il WebviewPanel come "editor attivo" → senza questo il focus
      // sull'input della webview cancellerebbe la selezione allegata.
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
      // selezione presente: la ricordo (per il caso "focus sulla webview")
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
    // selezione VUOTA nel file attivo: l'utente ha davvero deselezionato
    this.lastSelection = null;
    this.post({
      channel: "ide",
      payload: { type: "selection_cleared", reason: "empty-selection" } satisfies IdeEvent,
    });
  }

  /** selezione editor → questa webview (debounce) */
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

  // --- HTML della webview (stesso bundle per view e pannelli) -----------------

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

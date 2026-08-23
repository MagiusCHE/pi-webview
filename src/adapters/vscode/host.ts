// Host condiviso tra sidebar (view) e pannelli "nuova chat": spawna
// `pi --mode rpc`, traduce l'IDE bridge protocol via postMessage e gestisce
// le richieste IDE (config, sessioni, trust, allegati, selezione).

import * as vscode from "vscode";
import { existsSync, readFileSync } from "node:fs";
import { PiProcess } from "../../bridge/pi-process.ts";
import { resolvePi, checkBashOnWindows } from "../../bridge/spawn.ts";
import { ConfigStore, readCompactionSettings } from "../../bridge/config.ts";
import {
  listSessions,
  forkSession,
  getSessionInfo,
  renameSessionFile,
  deleteSessionFile,
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

  constructor(
    protected context: vscode.ExtensionContext,
    protected cb: PiHostCallbacks,
  ) {}

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

    this.pi = new PiProcess(
      piCmd.command,
      {
        onEvent: (evt) => {
          if (evt.type === "extension_ui_request") {
            this.handleExtensionUi(evt);
            return;
          }
          this.post({ channel: "rpc", payload: evt as RpcEvent });
        },
        onStderr: (line) => console.warn("[pi]", line),
        onExit: () => {
          void vscode.window.showWarningMessage("pi è terminato in modo inatteso");
          // avvisa la webview: sblocca la UI (working/compact) e mostra l'errore
          this.post({ channel: "rpc", payload: { type: "connection_closed" } });
        },
      },
      // marker: l'estensione pi-webview (lato pi) sa che è già integrato (niente re-install)
      {
        env: { ...process.env, PI_WEBVIEW_COMPANION: "1" },
        args: sessionArgs,
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

  postSelection(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
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
    const evt: IdeEvent =
      ranges.length > 0
        ? {
            type: "selection_changed",
            filePath: doc.uri.fsPath,
            workspaceFolder: vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath,
            ranges,
          }
        : { type: "selection_cleared", reason: "empty-selection" };
    this.post({ channel: "ide", payload: evt });
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

  // --- Extension UI protocol (gruppo A: dialoghi e notifiche) ---------------

  private handleExtensionUi(req: {
    id?: string;
    method?: string;
    title?: string;
    message?: string;
    notifyType?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
  }): void {
    const respond = (payload: Record<string, unknown>) => {
      this.pi?.send({ type: "extension_ui_response", ...payload });
    };
    switch (req.method) {
      case "select":
        void vscode.window
          .showQuickPick(req.options ?? [], {
            title: req.title,
            placeHolder: req.placeholder,
          })
          .then((v) =>
            v === undefined
              ? respond({ id: req.id, cancelled: true })
              : respond({ id: req.id, value: v }),
          );
        return;
      case "confirm":
        void vscode.window
          .showWarningMessage(req.message ?? req.title ?? "Confermi?", "OK", "Annulla")
          .then((v) => respond({ id: req.id, confirmed: v === "OK" }));
        return;
      case "input":
        void vscode.window
          .showInputBox({ prompt: req.title, placeHolder: req.placeholder })
          .then((v) =>
            v === undefined
              ? respond({ id: req.id, cancelled: true })
              : respond({ id: req.id, value: v }),
          );
        return;
      case "editor":
        void vscode.window
          .showInputBox({ prompt: req.title, value: req.prefill })
          .then((v) =>
            v === undefined
              ? respond({ id: req.id, cancelled: true })
              : respond({ id: req.id, value: v }),
          );
        return;
      case "notify":
        // le risposte dei comandi estensione (ui.notify) vanno in CHAT, non
        // in notifiche native VS Code: inoltra alla webview che le rende
        // come status line nel thread
        this.post({ channel: "rpc", payload: req as unknown as RpcEvent });
        return;
      default:
        // setStatus/setWidget/setTitle: NON sono dialoghi — inoltrati alla
        // webview, che li rende negli slot del footer (estensioni → badge)
        this.post({ channel: "rpc", payload: req as unknown as RpcEvent });
        return;
    }
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

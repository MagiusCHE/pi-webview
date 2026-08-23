// Pannelli "nuova chat" + manager delle chat aperte.
// Ogni chat è una webview con il PROPRIO processo pi: la sidebar è la chat 0,
// i pannelli (WebviewPanel, tab nell'editor area come Codex) sono le chat 1..n.
// La lista delle sessioni aperte è persistita in workspaceState: al riavvio
// la sidebar riprende la chat 0 e i pannelli vengono ricreati con le loro
// sessioni (--session <path>).

import * as vscode from "vscode";
import { PiWebviewHost } from "./host.ts";
import type { Frame } from "../../ide/protocol.ts";

const CHATS_KEY = "pi-webview.chats";
const LEGACY_SESSION_KEY = "pi-webview.sessionPath";

export class PiPanel extends PiWebviewHost {
  readonly panel: vscode.WebviewPanel;
  index: number; // posizione nella lista chat (0 = sidebar)

  constructor(context: vscode.ExtensionContext, index: number, resumeSession?: string) {
    super(context, {
      onSessionChange: (path) => PiPanelManager.instance(context).update(index, path),
      onNewChat: () => void PiPanelManager.instance(context).openNew(),
    });
    this.index = index;

    this.panel = vscode.window.createWebviewPanel(
      "pi-webview.panel",
      `pi${index > 0 ? ` ${index}` : ""}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "web")],
      },
    );
    this.webview = this.panel.webview;
    this.panel.webview.html = this.webviewHtml(this.panel.webview);
    this.startPi(resumeSession);

    this.panel.webview.onDidReceiveMessage((frame: Frame) => {
      void this.handleFrame(frame);
    });

    this.panel.onDidDispose(() => {
      this.dispose();
      PiPanelManager.instance(context).remove(index);
    });

    this.attachSelectionListener();
  }

  reveal(): void {
    this.panel.reveal();
  }
}

export class PiPanelManager {
  private static inst: PiPanelManager | null = null;
  private panels: PiPanel[] = [];

  static instance(context: vscode.ExtensionContext): PiPanelManager {
    if (!PiPanelManager.inst) PiPanelManager.inst = new PiPanelManager(context);
    return PiPanelManager.inst;
  }

  private constructor(private context: vscode.ExtensionContext) {
    // migrazione: la vecchia chiave singola diventa la chat 0
    const chats = this.context.workspaceState.get<string[]>(CHATS_KEY);
    if (!chats) {
      const legacy = this.context.workspaceState.get<string>(LEGACY_SESSION_KEY);
      if (legacy) {
        void this.context.workspaceState.update(CHATS_KEY, [legacy]);
        void this.context.workspaceState.update(LEGACY_SESSION_KEY, null);
      }
    }
  }

  private chats(): string[] {
    return this.context.workspaceState.get<string[]>(CHATS_KEY) ?? [];
  }

  private persist(list: string[]): void {
    void this.context.workspaceState.update(CHATS_KEY, list.length ? list : null);
  }

  /** sessione della chat all'indice i (0 = sidebar), se presente */
  sessionAt(index: number): string | undefined {
    return this.chats()[index];
  }

  /** aggiorna la sessione corrente di una chat e persiste */
  update(index: number, path: string): void {
    const list = this.chats();
    while (list.length <= index) list.push("");
    list[index] = path;
    this.persist(list);
  }

  /** rimuove un pannello chiuso (la sidebar non si chiude mai) */
  remove(index: number): void {
    const list = this.chats();
    if (index <= 0 || index >= list.length) return;
    list.splice(index, 1);
    this.persist(list);
    const target = this.panels.find((p) => p.index === index);
    if (target) this.panels = this.panels.filter((p) => p !== target);
    // gli indici dei pannelli rimasti dopo quello chiuso scalano
    for (const p of this.panels) if (p.index > index) p.index--;
  }

  /** rimuove una sessione ELIMINATA da tutte le chat salvate (workspaceState) */
  removePath(path: string): void {
    const list = this.chats();
    const next = list.filter((p) => p !== path);
    if (next.length !== list.length) this.persist(next);
  }

  /** apre una NUOVA chat (sessione fresca) in un pannello */
  openNew(): void {
    const index = this.chats().length; // dopo la sidebar e i pannelli esistenti
    this.update(index, ""); // placeholder: la sessione arriva dalla webview
    const panel = new PiPanel(this.context, index);
    this.panels.push(panel);
    panel.reveal();
  }

  /** al riavvio: ricrea i pannelli dalle chat salvate (la sidebar fa da sé) */
  restore(): void {
    const list = this.chats();
    for (let i = 1; i < list.length; i++) {
      const path = list[i];
      if (!path) continue; // chat mai arrivata a una sessione: salta
      const panel = new PiPanel(this.context, i, path);
      this.panels.push(panel);
    }
  }
}

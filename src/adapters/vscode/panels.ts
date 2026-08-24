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
const COLUMNS_KEY = "pi-webview.chatColumns";
const LEGACY_SESSION_KEY = "pi-webview.sessionPath";

export class PiPanel extends PiWebviewHost {
  readonly panel: vscode.WebviewPanel;
  index: number; // posizione nella lista chat (0 = sidebar)

  constructor(
    context: vscode.ExtensionContext,
    index: number,
    resumeSession?: string,
    column?: number,
  ) {
    super(context, {
      // indice risolto per IDENTITÀ al momento della segnalazione (mai
      // l'indice catturato alla costruzione: dopo un remove() gli indici
      // scalano e una closure con l'indice vecchio ricreava duplicati)
      onSessionChange: (path) => {
        const mgr = PiPanelManager.instance(context);
        const idx = mgr.indexOfPanel(this);
        mgr.update(idx >= 0 ? idx : index, path);
      },
      onNewChat: () => void PiPanelManager.instance(context).openNew(),
    });
    this.index = index;

    // colonna = gruppo editor in cui RICREARE il pannello al reload: se
    // manca (prima apertura) → ViewColumn.Beside (nuovo gruppo accanto)
    const targetColumn =
      column !== undefined && column > 0 ? column : vscode.ViewColumn.Beside;
    this.panel = vscode.window.createWebviewPanel(
      "pi-webview.panel",
      `pi${index > 0 ? ` ${index}` : ""}`,
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "web")],
      },
    );
    this.webview = this.panel.webview;
    try {
      this.panel.webview.html = this.webviewHtml(this.panel.webview);
    // pannello in AREA EDITOR: la selezione allegata è inaffidabile (il focus
    // sul pannello azzera il contesto dell'editor attivo) → inibisci il blocco
    // selezione in questa webview (evento panel_mode)
    this.post({ channel: "rpc", payload: { type: "panel_mode", enabled: true } });
    } catch (err) {
      // UI non caricabile (es. dist/web mancante nel vsix): MAI lasciare un
      // pannello vuoto orfano — dispose e rilancia (openNew/restore mostrano
      // il messaggio e non lo tracciano)
      this.panel.dispose();
      throw new Error(
        `UI non caricabile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.startPi(resumeSession);

    this.panel.webview.onDidReceiveMessage((frame: Frame) => {
      void this.handleFrame(frame);
    });

    // persiste la colonna a ogni cambio di gruppo (drag/riorganizzazione),
    // così il reload ricrea il pannello nello STESSO gruppo — niente gruppi
    // vuoti che si accumulano (createWebviewPanel con Beside a ogni reload
    // aprirebbe un gruppo nuovo, e VS Code tiene quelli vecchi vuoti)
    this.panel.onDidChangeViewState(() => {
      const col = this.panel.viewColumn;
      PiPanelManager.instance(context).setColumn(index, col);
    });
    const col = this.panel.viewColumn;
    if (col) PiPanelManager.instance(context).setColumn(index, col);

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
    // pulizia una tantum: rimuove duplicati/voci vuote residue (bug storici
    // di indici stantii: dopo un remove() gli indici scalavano ma le closure
    // dei pannelli scrivevano ancora sull'indice vecchio → path duplicati)
    const seen = new Set<string>();
    const cleaned = this.chats().filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    if (cleaned.length !== this.chats().length) this.persist(cleaned);
  }

  private chats(): string[] {
    return this.context.workspaceState.get<string[]>(CHATS_KEY) ?? [];
  }

  private persist(list: string[]): void {
    void this.context.workspaceState.update(CHATS_KEY, list.length ? list : null);
  }

  /** colonne (gruppi editor) dei pannelli, allineate a chats() per indice */
  private columns(): (number | undefined)[] {
    return this.context.workspaceState.get<number[]>(COLUMNS_KEY) ?? [];
  }

  private persistColumns(cols: (number | undefined)[]): void {
    const cleaned = cols.filter((c): c is number => typeof c === "number");
    void this.context.workspaceState.update(COLUMNS_KEY, cleaned.length ? cleaned : null);
  }

  /** salva la colonna del pannello (per ricrearlo nello stesso gruppo al reload) */
  setColumn(index: number, column: number | undefined): void {
    if (index <= 0 || !column) return; // la sidebar (0) non ha colonna editor
    const cols = this.columns();
    while (cols.length <= index) cols.push(undefined);
    cols[index] = column;
    this.persistColumns(cols);
  }

  /** sessione della chat all'indice i (0 = sidebar), se presente */
  sessionAt(index: number): string | undefined {
    return this.chats()[index];
  }

  /** indice corrente del pannello (1-based; 0 = sidebar). Risolto per
   *  IDENTITÀ dell'oggetto, mai per indice catturato: dopo un remove() gli
   *  indici scalano e le closure con l'indice vecchio ricreavano duplicati. */
  indexOfPanel(panel: PiPanel): number {
    const pos = this.panels.indexOf(panel);
    return pos >= 0 ? pos + 1 : -1;
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

  /** prima colonna (gruppo editor) disponibile NON bloccata — come l'apertura
   *  di un file nella vista filesystem: gruppo attivo se sbloccato, altrimenti
   *  il primo gruppo sbloccato; solo se TUTTI sono bloccati → gruppo nuovo.
   *  NB: isLocked non è nei tipi @types/vscode 1.125 (esiste nel runtime) →
   *  cast locale; su VS Code vecchi è undefined (falsy) = non bloccato */
  private firstUnlockedColumn(): vscode.ViewColumn {
    const lock = (g: vscode.TabGroup) =>
      (g as vscode.TabGroup & { isLocked?: boolean }).isLocked === true;
    const active = vscode.window.tabGroups.activeTabGroup;
    if (active && !lock(active)) return active.viewColumn;
    const first = vscode.window.tabGroups.all.find((g) => !lock(g));
    return first ? first.viewColumn : vscode.ViewColumn.Beside;
  }

  /** apre una NUOVA chat (sessione fresca) in un pannello */
  openNew(): void {
    const index = this.chats().length; // dopo la sidebar e i pannelli esistenti
    this.update(index, ""); // placeholder: la sessione arriva dalla webview
    try {
      // si apre nel gruppo attivo/first-unlocked (mai SEMPRE un gruppo nuovo)
      const panel = new PiPanel(this.context, index, undefined, this.firstUnlockedColumn());
      this.panels.push(panel);
      panel.reveal();
    } catch (err) {
      // costruzione fallita (es. dist/web illeggibile): il costruttore ha già
      // fatto dispose del pannello → nessun pannello vuoto orfano in giro
      void vscode.window.showErrorMessage(
        `pi-webview: impossibile aprire la chat: ${err instanceof Error ? err.message : String(err)}`,
      );
      // togli il placeholder: la chat non esiste
      const list = this.chats();
      if (list.length > index) {
        list.splice(index, 1);
        if (list.length) {
          this.persist(list);
        } else {
          void this.context.workspaceState.update(CHATS_KEY, null);
        }
      }
    }
  }

  /** al riavvio: ricrea i pannelli dalle chat salvate (la sidebar fa da sé) */
  restore(): void {
    const list = this.chats();
    const cols = this.columns();
    for (let i = 1; i < list.length; i++) {
      const path = list[i];
      if (!path) continue; // chat mai arrivata a una sessione: salta
      try {
        // ricrea il pannello nella STESSA colonna in cui era: VS Code
        // ripristina i gruppi editor del layout precedente (quello del panel
        // resta VUOTO dopo il reload); creare con ViewColumn.Beside a ogni
        // reload aprirebbe un gruppo NUOVO → i gruppi vuoti si accumulano
        const panel = new PiPanel(this.context, i, path, cols[i]);
        this.panels.push(panel);
      } catch (err) {
        // pannello non costruibile: dispose già fatto dal costruttore, niente
        // pannelli vuoti orfani; la sessione resta salvata (riprovata al
        // prossimo reload — il messaggio spiega il perché)
        void vscode.window.showErrorMessage(
          `pi-webview: impossibile ripristinare la chat: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

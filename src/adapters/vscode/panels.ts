// "New chat" panels + manager of open chats.
// Each chat is a webview with its OWN pi process: the sidebar is chat 0,
// panels (WebviewPanel, editor-area tabs like Codex) are chats 1..n.
// The list of open sessions is persisted in workspaceState: on restart the
// sidebar resumes chat 0 and the panels are recreated with their sessions
// (--session <path>).

import * as vscode from "vscode";
import { PiWebviewHost } from "./host.ts";
import type { Frame } from "../../ide/protocol.ts";

const CHATS_KEY = "pi-webview.chats";
const COLUMNS_KEY = "pi-webview.chatColumns";
const LEGACY_SESSION_KEY = "pi-webview.sessionPath";

export class PiPanel extends PiWebviewHost {
  readonly panel: vscode.WebviewPanel;
  index: number; // position in the chat list (0 = sidebar)

  constructor(
    context: vscode.ExtensionContext,
    index: number,
    resumeSession?: string,
    column?: number,
  ) {
    super(context, {
      // index resolved by IDENTITY at notification time (never the index
      // captured at construction: after a remove() the indices shift and a
      // closure with the old index recreated duplicates)
      onSessionChange: (path) => {
        const mgr = PiPanelManager.instance(context);
        const idx = mgr.indexOfPanel(this);
        mgr.update(idx >= 0 ? idx : index, path);
      },
      onNewChat: () => void PiPanelManager.instance(context).openNew(),
    });
    this.index = index;

    // column = editor group in which to RECREATE the panel on reload: if
    // missing (first open) → ViewColumn.Beside (new group next to it)
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
    // panel in EDITOR AREA: the attached selection is unreliable (panel
    // focus clears the active-editor context) → disable the selection block
    // in this webview (panel_mode event)
    this.post({ channel: "rpc", payload: { type: "panel_mode", enabled: true } });
    } catch (err) {
      // UI not loadable (e.g. dist/web missing in the vsix): NEVER leave an
      // orphan empty panel — dispose and rethrow (openNew/restore show the
      // message and do not track it)
      this.panel.dispose();
      throw new Error(
        `UI non caricabile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.startPi(resumeSession);

    this.panel.webview.onDidReceiveMessage((frame: Frame) => {
      void this.handleFrame(frame);
    });

    // persists the column on every group change (drag/rearrange), so the
    // reload recreates the panel in the SAME group — no empty groups piling
    // up (createWebviewPanel with Beside on every reload would open a new
    // group, and VS Code keeps the old empty ones)
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
    // migration: the old single key becomes chat 0
    const chats = this.context.workspaceState.get<string[]>(CHATS_KEY);
    if (!chats) {
      const legacy = this.context.workspaceState.get<string>(LEGACY_SESSION_KEY);
      if (legacy) {
        void this.context.workspaceState.update(CHATS_KEY, [legacy]);
        void this.context.workspaceState.update(LEGACY_SESSION_KEY, null);
      }
    }
    // one-time cleanup: removes leftover duplicates/empty entries (historical
    // bugs with stale indices: after a remove() the indices shifted but the
    // panel closures still wrote on the old index → duplicated paths)
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

  /** editor-group columns of the panels, aligned with chats() by index */
  private columns(): (number | undefined)[] {
    return this.context.workspaceState.get<number[]>(COLUMNS_KEY) ?? [];
  }

  private persistColumns(cols: (number | undefined)[]): void {
    const cleaned = cols.filter((c): c is number => typeof c === "number");
    void this.context.workspaceState.update(COLUMNS_KEY, cleaned.length ? cleaned : null);
  }

  /** saves the panel column (to recreate it in the same group on reload) */
  setColumn(index: number, column: number | undefined): void {
    if (index <= 0 || !column) return; // the sidebar (0) has no editor column
    const cols = this.columns();
    while (cols.length <= index) cols.push(undefined);
    cols[index] = column;
    this.persistColumns(cols);
  }

  /** session of the chat at index i (0 = sidebar), if any */
  sessionAt(index: number): string | undefined {
    return this.chats()[index];
  }

  /** current index of the panel (1-based; 0 = sidebar). Resolved by object
   *  IDENTITY, never by a captured index: after a remove() the indices shift
   *  and closures with the old index recreated duplicates. */
  indexOfPanel(panel: PiPanel): number {
    const pos = this.panels.indexOf(panel);
    return pos >= 0 ? pos + 1 : -1;
  }

  /** updates the current session of a chat and persists */
  update(index: number, path: string): void {
    const list = this.chats();
    while (list.length <= index) list.push("");
    list[index] = path;
    this.persist(list);
  }

  /** removes a closed panel (the sidebar is never closed) */
  remove(index: number): void {
    const list = this.chats();
    if (index <= 0 || index >= list.length) return;
    list.splice(index, 1);
    this.persist(list);
    const target = this.panels.find((p) => p.index === index);
    if (target) this.panels = this.panels.filter((p) => p !== target);
    // indices of the panels after the closed one shift down
    for (const p of this.panels) if (p.index > index) p.index--;
  }

  /** removes a DELETED session from all saved chats (workspaceState) */
  removePath(path: string): void {
    const list = this.chats();
    const next = list.filter((p) => p !== path);
    if (next.length !== list.length) this.persist(next);
  }

  /** first AVAILABLE (unlocked) editor group — like opening a file in the
   *  filesystem view: active group if unlocked, else the first unlocked
   *  group; only if ALL are locked → new group.
   *  NOTE: isLocked is not in @types/vscode 1.125 types (exists at runtime) →
   *  local cast; on old VS Code it is undefined (falsy) = unlocked */
  private firstUnlockedColumn(): vscode.ViewColumn {
    const lock = (g: vscode.TabGroup) =>
      (g as vscode.TabGroup & { isLocked?: boolean }).isLocked === true;
    const active = vscode.window.tabGroups.activeTabGroup;
    if (active && !lock(active)) return active.viewColumn;
    const first = vscode.window.tabGroups.all.find((g) => !lock(g));
    return first ? first.viewColumn : vscode.ViewColumn.Beside;
  }

  /** opens a NEW chat (fresh session) in a panel */
  openNew(): void {
    const index = this.chats().length; // after the sidebar and existing panels
    this.update(index, ""); // placeholder: the session comes from the webview
    try {
      // opens in the active/first-unlocked group (never ALWAYS a new group)
      const panel = new PiPanel(this.context, index, undefined, this.firstUnlockedColumn());
      this.panels.push(panel);
      panel.reveal();
    } catch (err) {
      // construction failed (e.g. dist/web unreadable): the constructor
      // already disposed the panel → no orphan empty panel around
      void vscode.window.showErrorMessage(
        `pi-webview: impossibile aprire la chat: ${err instanceof Error ? err.message : String(err)}`,
      );
      // remove the placeholder: the chat does not exist
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

  /** on restart: recreates the panels from the saved chats (the sidebar does on its own) */
  restore(): void {
    const list = this.chats();
    const cols = this.columns();
    for (let i = 1; i < list.length; i++) {
      const path = list[i];
      if (!path) continue; // chat never reached a session: skip
      try {
        // recreates the panel in the SAME column it was: VS Code restores
        // the editor groups of the previous layout (the panel one stays
        // EMPTY after reload); creating with ViewColumn.Beside on every
        // reload would open a NEW group → empty groups pile up
        const panel = new PiPanel(this.context, i, path, cols[i]);
        this.panels.push(panel);
      } catch (err) {
        // panel not buildable: dispose already done by the constructor, no
        // orphan empty panels; the session stays saved (retried on the next
        // reload — the message explains why)
        void vscode.window.showErrorMessage(
          `pi-webview: impossibile ripristinare la chat: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

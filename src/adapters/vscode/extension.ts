// Entry point dell'extension VS Code (piano 0002).
// Sidebar (webview "pi") + pannelli "nuova chat" (PiPanelManager), comandi
// attach-selection / focus / new-chat. Inoltre consuma il reload signal:
// quando l'estensione pi aggiorna il companion mentre la finestra è aperta,
// la versione caricata in memoria resta la vecchia → notifica di reload.

import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, rmSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PiWebviewProvider } from "./provider.ts";
import { PiPanelManager } from "./panels.ts";

let provider: PiWebviewProvider | null = null;

// Segnale di reload scritto dall'estensione pi quando il companion viene
// AGGIORNATO mentre l'IDE è aperto (contratto multi-IDE: docs/concept/0004).
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

// Legge il segnale e reagisce: se la versione caricata è già quella del segnale
// (VS Code riavviato dopo l'update) → pulizia silenziosa; se è più vecchia →
// notifica di reload della finestra. Il segnale viene sempre rimosso qui.
function checkReloadSignal(context: vscode.ExtensionContext): void {
  try {
    if (!existsSync(RELOAD_SIGNAL)) return;
    const signal = JSON.parse(readFileSync(RELOAD_SIGNAL, "utf-8")) as {
      version?: string;
    };
    const installedVersion = context.extension.packageJSON.version as
      | string
      | undefined;
    rmSync(RELOAD_SIGNAL, { force: true });
    if (!signal.version || !installedVersion) return;
    if (signal.version === installedVersion) return; // già sulla nuova versione
    void vscode.window
      .showInformationMessage(
        `pi-webview: companion aggiornato da ${installedVersion} a ${signal.version}. Riavvia la finestra per attivare la nuova versione.`,
        "Ripristina",
      )
      .then((choice) => {
        if (choice === "Ripristina") {
          void vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  } catch {
    // best effort: mai rompere l'attivazione per un segnale
  }
}

export function activate(context: vscode.ExtensionContext): void {
  provider = new PiWebviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("piWebview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pi-webview.attachSelection", () => {
      provider?.postSelection();
    }),
    // icona nella barra superiore (editor/title, come Codex/pi-x-ide): porta
    // il pannello pi in foreground (focus della view + reveal del container)
    vscode.commands.registerCommand("pi-webview.focus", () => {
      void vscode.commands.executeCommand("piWebview.focus").then(
        () => undefined,
        () => void vscode.commands.executeCommand("workbench.view.extension.pi-webview"),
      );
    }),
    // nuova chat in un pannello separato (icona nel header della webview)
    vscode.commands.registerCommand("pi-webview.newChat", () => {
      PiPanelManager.instance(context).openNew();
    }),
  );

  // reload signal: check all'avvio (copre il segnale scritto a VS Code chiuso)
  // + watcher sulla dir (copre l'update mentre la finestra è APERTA)
  checkReloadSignal(context);
  try {
    mkdirSync(dirname(RELOAD_SIGNAL), { recursive: true });
    const watcher = watch(dirname(RELOAD_SIGNAL), (_event, filename) => {
      if (filename === basename(RELOAD_SIGNAL)) checkReloadSignal(context);
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // watch non disponibile: il check all'avvio copre il caso riavvio
  }

  // al riavvio riapri le chat salvate: la sidebar riprende da sola la chat 0
  // (--session), qui si ricreano i pannelli con le loro sessioni
  PiPanelManager.instance(context).restore();
}

export function deactivate(): void {
  provider?.dispose();
  provider = null;
}

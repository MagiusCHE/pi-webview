// Entry point dell'extension VS Code (piano 0002).
// Sidebar (webview "pi") + pannelli "nuova chat" (PiPanelManager), comandi
// attach-selection / focus / new-chat.

import * as vscode from "vscode";
import { PiWebviewProvider } from "./provider.ts";
import { PiPanelManager } from "./panels.ts";

let provider: PiWebviewProvider | null = null;

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

  // al riavvio riapri le chat salvate: la sidebar riprende da sola la chat 0
  // (--session), qui si ricreano i pannelli con le loro sessioni
  PiPanelManager.instance(context).restore();
}

export function deactivate(): void {
  provider?.dispose();
  provider = null;
}

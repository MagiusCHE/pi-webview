// Adapter VS Code (piano 0002): webview della sidebar. La logica condivisa
// (spawn pi, bridge protocol, selezione) vive in PiWebviewHost (host.ts);
// qui solo il wiring della view e la gestione della chat 0 (sidebar).

import * as vscode from "vscode";
import { PiWebviewHost } from "./host.ts";
import { PiPanelManager } from "./panels.ts";
import type { Frame } from "../../ide/protocol.ts";

export class PiWebviewProvider
  extends PiWebviewHost
  implements vscode.WebviewViewProvider
{
  constructor(context: vscode.ExtensionContext) {
    super(context, {
      onSessionChange: (path) => PiPanelManager.instance(context).update(0, path),
      onNewChat: () => void PiPanelManager.instance(context).openNew(),
    });
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "web")],
    };
    webviewView.webview.html = this.webviewHtml(webviewView.webview);

    // la sidebar è la chat 0: riprende la prima sessione salvata (se esiste)
    this.startPi(PiPanelManager.instance(this.context).sessionAt(0));

    webviewView.webview.onDidReceiveMessage((frame: Frame) => {
      void this.handleFrame(frame);
    });

    webviewView.onDidDispose(() => this.dispose());

    this.attachSelectionListener();
  }
}

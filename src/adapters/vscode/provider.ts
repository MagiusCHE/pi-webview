// VS Code adapter (plan 0002): sidebar webview. Shared logic (pi spawn,
// bridge protocol, selection) lives in PiWebviewHost (host.ts); here only
// the view wiring and chat 0 (sidebar) management.

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

    // the sidebar is chat 0: resumes the first saved session (if any)
    this.startPi(PiPanelManager.instance(this.context).sessionAt(0));

    webviewView.webview.onDidReceiveMessage((frame: Frame) => {
      void this.handleFrame(frame);
    });

    webviewView.onDidDispose(() => this.dispose());

    this.attachSelectionListener();
  }
}

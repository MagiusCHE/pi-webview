// VS Code extension entry point (plan 0002).
// Sidebar (webview "pi") + "new chat" panels (PiPanelManager), commands
// attach-selection / focus / new-chat. Also consumes the reload signal:
// when the pi extension updates the companion while the window is open,
// the loaded in-memory version stays the old one → notify reload.

import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, rmSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PiWebviewProvider } from "./provider.ts";
import { PiPanelManager } from "./panels.ts";
import { hostT, hostLocale, logLine, resetLogIfOversized } from "./host.ts";

let provider: PiWebviewProvider | null = null;

// Reload signal written by the pi extension when the companion is UPDATED
// while the IDE is open (multi-IDE contract: docs/concept/0004).
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

// Reads the signal and reacts: if the loaded version already matches the
// signal (VS Code restarted after the update) → silent cleanup; if it is
// older → notify window reload. The signal is always removed here.
function checkReloadSignal(context: vscode.ExtensionContext): void {
  try {
    if (!existsSync(RELOAD_SIGNAL)) return;
    const signal = JSON.parse(readFileSync(RELOAD_SIGNAL, "utf-8")) as {
      version?: string;
    };
    const installedVersion = context.extension.packageJSON.version as string | undefined;
    rmSync(RELOAD_SIGNAL, { force: true });
    if (!signal.version || !installedVersion) return;
    if (signal.version === installedVersion) return; // already on the new version
    const locale = hostLocale();
    void vscode.window
      .showInformationMessage(
        hostT(
          locale,
          `pi-webview: companion aggiornato da ${installedVersion} a ${signal.version}. Riavvia la finestra per attivare la nuova versione.`,
          `pi-webview: companion updated from ${installedVersion} to ${signal.version}. Reload the window to activate the new version.`,
        ),
        hostT(locale, "Ripristina", "Reload"),
      )
      .then((choice) => {
        if (choice === "Ripristina" || choice === "Reload") {
          void vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  } catch {
    // best effort: never break activation because of a signal
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // deterministic log (see host.ts logLine): confirms which companion version
  // is actually loaded on a user machine → ~/.pi/pi-webview/companion.log
  resetLogIfOversized(); // session startup: reset the log if it exceeds 2MB
  logLine(`activate version=${context.extension.packageJSON.version ?? "?"}`);
  provider = new PiWebviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("piWebview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pi-webview.attachSelection", () => {
      provider?.postSelection();
    }),
    // icon in the top bar (editor/title, like Codex/pi-x-ide): brings the
    // pi panel to the foreground (view focus + container reveal)
    vscode.commands.registerCommand("pi-webview.focus", () => {
      void vscode.commands.executeCommand("piWebview.focus").then(
        () => undefined,
        () => void vscode.commands.executeCommand("workbench.view.extension.pi-webview"),
      );
    }),
    // new chat in a separate panel (icon in the webview header)
    vscode.commands.registerCommand("pi-webview.newChat", () => {
      PiPanelManager.instance(context).openNew();
    }),
  );

  // reload signal: check at startup (covers the signal written while VS Code
  // was closed) + watcher on the dir (covers the update while the window is OPEN)
  checkReloadSignal(context);
  try {
    mkdirSync(dirname(RELOAD_SIGNAL), { recursive: true });
    const watcher = watch(dirname(RELOAD_SIGNAL), (_event, filename) => {
      if (filename === basename(RELOAD_SIGNAL)) checkReloadSignal(context);
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // watch unavailable: the startup check covers the restart case
  }

  // on restart reopen the saved chats: the sidebar resumes chat 0 on its
  // own (--session); here the panels are recreated with their sessions
  PiPanelManager.instance(context).restore();
}

export function deactivate(): void {
  provider?.dispose();
  provider = null;
}

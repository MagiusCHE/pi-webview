// Detection of the UI execution mode:
// - "standalone" → normal browser (WebSocket bridge)
// - "vscode"     → VS Code webview (postMessage, IDE theme)
// - "ide"        → other IDE (future: they inject a global or an ?ide=…)
// Allows varying the behavior based on the environment (concept 0002 D2/D3).

export type RuntimeMode = "standalone" | "vscode" | "ide";

export interface RuntimeInfo {
  mode: RuntimeMode;
  isIDE: boolean;
  isVsCode: boolean;
}

function detectMode(): RuntimeMode {
  const win = window as unknown as {
    acquireVsCodeApi?: unknown;
    chrome?: { webview?: unknown };
  };
  if (typeof win.acquireVsCodeApi === "function") return "vscode";
  // WebView2 (Visual Studio adapter, concept 0005): same "ide" channel
  if (win.chrome?.webview) return "ide";
  // future IDEs: injected marker (global) or explicit query param
  const params = new URLSearchParams(location.search);
  if (params.get("ide")) return "ide";
  return "standalone";
}

export const runtime: RuntimeInfo = (() => {
  const mode = detectMode();
  return {
    mode,
    isIDE: mode !== "standalone",
    isVsCode: mode === "vscode",
  };
})();

export function isVsCodeRuntime(): boolean {
  return runtime.isVsCode;
}

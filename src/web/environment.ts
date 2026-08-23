// Rilevamento della modalità di esecuzione della UI:
// - "standalone" → browser normale (bridge WebSocket)
// - "vscode"     → webview di VS Code (postMessage, tema dell'IDE)
// - "ide"        → altro IDE (futuro: iniettano un global o un ?ide=…)
// Permette di variare il comportamento in base all'ambiente (concept 0002 D2/D3).

export type RuntimeMode = "standalone" | "vscode" | "ide";

export interface RuntimeInfo {
  mode: RuntimeMode;
  isIDE: boolean;
  isVsCode: boolean;
}

function detectMode(): RuntimeMode {
  const win = window as unknown as { acquireVsCodeApi?: unknown };
  if (typeof win.acquireVsCodeApi === "function") return "vscode";
  // futuri IDE: marker iniettato (global) o query param esplicito
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

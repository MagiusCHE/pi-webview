// Gestione tema della UI (concept 0002 D7):
// - webview VS Code → il tema lo passa l'IDE (data-vscode-theme-kind sul body,
//   variabili CSS --vscode-*, messaggio "vscode-theme-changed")
// - standalone → preferenza utente (light/dark/system, default system)

import type { ThemePreference } from "../ide/protocol.ts";

export type EffectiveTheme = "light" | "dark";

export function systemTheme(): EffectiveTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function effectiveTheme(pref: ThemePreference): EffectiveTheme {
  return pref === "system" ? systemTheme() : pref;
}

// In webview VS Code: il body ha l'attributo data-vscode-theme-kind.
function vscodeThemeKind(): EffectiveTheme | null {
  const kind = document.body?.dataset.vscodeThemeKind;
  if (kind === "vscode-light") return "light";
  if (kind === "vscode-dark" || kind === "vscode-high-contrast") return "dark";
  return null;
}

export function applyTheme(pref: ThemePreference): void {
  const effective = vscodeThemeKind() ?? effectiveTheme(pref);
  document.documentElement.dataset.theme = effective;
}

export function watchThemeChanges(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  const onMessage = (e: MessageEvent) => {
    const msg = e.data as { type?: string };
    if (msg?.type === "vscode-theme-changed") cb();
  };
  window.addEventListener("message", onMessage);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("message", onMessage);
  };
}

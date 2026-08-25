// Internationalization — same pattern as radv-2/client:
// JSON per language, system language from the browser, saved preference,
// fallback on Italian. Safe to import in Node (for tests).

import it from "./locale/it.json" with { type: "json" };
import en from "./locale/en.json" with { type: "json" };

export type LocaleId = "it" | "en";

export interface LocaleDict {
  language: string;
  ui: Record<string, string>;
}

export const LOCALES: Record<LocaleId, LocaleDict> = { it, en };

export const STORAGE_KEY = "pi-webview-locale";

export function isLocaleId(v: string | null): v is LocaleId {
  return v === "it" || v === "en";
}

function detectSystemLocale(): LocaleId {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "") ?? "";
  return lang.toLowerCase().startsWith("it") ? "it" : "en";
}

function readStored(): LocaleId | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocaleId(v) ? v : null;
  } catch {
    return null; // localStorage non disponibile (es. Node nei test)
  }
}

export let currentLocale: LocaleId = readStored() ?? detectSystemLocale();

export function t(key: string): string {
  return LOCALES[currentLocale].ui[key] ?? LOCALES.it.ui[key] ?? key;
}

// placeholder {name} replacement in localized strings
// (e.g. tpl(t("tpsSummary"), { tokens: "43", time: "0.7" }))
export function tpl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

export function setLocale(id: LocaleId): void {
  currentLocale = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignored
  }
}

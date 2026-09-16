import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type ReminderLocale = "it" | "en";

export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/hcdjfkcgojomhpmcfgipginghhlncamn";

interface ReminderState {
  lastShownVersion?: string;
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [main = "", prerelease] = value.replace(/^v/, "").split("-", 2);
    return {
      main: main.split(".").map((part) => Number.parseInt(part, 10) || 0),
      prerelease,
    };
  };
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.main.length, right.main.length);
  for (let index = 0; index < length; index++) {
    const difference = (left.main[index] ?? 0) - (right.main[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function shouldShowReleaseReminder(
  currentVersion: string,
  lastShownVersion?: string,
): boolean {
  if (!lastShownVersion) return true;
  return compareVersions(currentVersion, lastShownVersion) > 0;
}

export class ReleaseReminderStore {
  private readonly file: string;

  constructor(dir = join(homedir(), ".pi", "pi-webview")) {
    this.file = join(dir, "release-reminder.json");
  }

  lastShownVersion(): string | undefined {
    try {
      const state = JSON.parse(readFileSync(this.file, "utf8")) as ReminderState;
      return typeof state.lastShownVersion === "string"
        ? state.lastShownVersion
        : undefined;
    } catch {
      return undefined;
    }
  }

  shouldShow(version: string): boolean {
    return shouldShowReleaseReminder(version, this.lastShownVersion());
  }

  markShown(version: string): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastShownVersion: version }, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}

export function formatWaysReminder(version: string, locale: ReminderLocale): string {
  if (locale === "en") {
    return [
      `pi-webview ${version} was installed or updated.`,
      "Available ways to use pi-webview:",
      "• Browser View — run `piw` to open pi-webview locally in your browser. For private remote access over Tailscale, run `piw-public 7361 --tailscale`.",
      "• Visual Studio Code — the bundled companion is installed and updated automatically when VS Code is detected. Open it from the pi icon in the Activity Bar.",
      "• Visual Studio 2022/2026 — the bundled Windows companion is installed and updated automatically when Visual Studio is detected. Open the pi tool window.",
      `• Google Chrome Side Panel — install it from the Chrome Web Store (${CHROME_WEB_STORE_URL}), then open pi-webview from Chrome's side panel.`,
    ].join("\n");
  }
  return [
    `pi-webview ${version} è stato installato o aggiornato.`,
    "Modalità disponibili in pi-webview:",
    "• Browser View — esegui `piw` per aprire pi-webview localmente nel browser. Per l’accesso remoto privato tramite Tailscale, esegui `piw-public 7361 --tailscale`.",
    "• Visual Studio Code — il companion incluso viene installato e aggiornato automaticamente quando VS Code viene rilevato. Aprilo dall’icona pi nella Activity Bar.",
    "• Visual Studio 2022/2026 — il companion Windows incluso viene installato e aggiornato automaticamente quando Visual Studio viene rilevato. Apri la tool window pi.",
    `• Google Chrome Side Panel — installalo dal Chrome Web Store (${CHROME_WEB_STORE_URL}), quindi apri pi-webview dal pannello laterale di Chrome.`,
  ].join("\n");
}

function versionSection(markdown: string, version: string): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\s+-.*)?$`, "m");
  const match = heading.exec(markdown);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return rest.slice(0, next?.index ?? rest.length).trim();
}

export function extractReleaseNotes(
  markdown: string,
  version: string,
  locale: ReminderLocale,
): string[] {
  const section = versionSection(markdown, version);
  if (!section) return [];
  const languageHeading = locale === "it" ? "Italiano" : "English";
  const heading = new RegExp(`^###\\s+${languageHeading}\\s*$`, "mi");
  const match = heading.exec(section);
  const localized = match
    ? (section.slice(match.index + match[0].length).split(/^###\s+/m, 1)[0] ?? "")
    : section;
  return localized
    .split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(.+?)\s*$/.exec(line)?.[1] ?? "")
    .filter(Boolean);
}

export function formatChangelogReminder(
  version: string,
  notes: string[],
  locale: ReminderLocale,
): string | null {
  if (notes.length === 0) return null;
  const title =
    locale === "it"
      ? `Novità in pi-webview ${version}:`
      : `What's new in pi-webview ${version}:`;
  return [title, ...notes.map((note) => `• ${note}`)].join("\n");
}

// One normal informational notice for the release. Keeping the changelog and
// the available modes together lets every UI render the same complete update
// message without using warning styling.
export function formatReleaseReminder(
  version: string,
  markdown: string,
  locale: ReminderLocale,
): string {
  const changelog = formatChangelogReminder(
    version,
    extractReleaseNotes(markdown, version, locale),
    locale,
  );
  return [formatWaysReminder(version, locale), changelog].filter(Boolean).join("\n\n");
}

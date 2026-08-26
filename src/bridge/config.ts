// User config in a per-OS dedicated folder (concept 0002 D7):
// - Linux:   $XDG_CONFIG_HOME/pi-webview  (default ~/.config/pi-webview)
// - macOS:   ~/Library/Application Support/pi-webview
// - Windows: %APPDATA%\pi-webview
// The file is config.json. Serves the UI and the future IDE adapter.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { CompactionSettings, UserConfig } from "../ide/protocol.ts";

export const DEFAULT_CONFIG: UserConfig = {
  theme: "system",
  historyLimit: 120,
  statsBarPosition: "above",
};

// default thresholds of pi's automatic compaction (config ~/.pi/config.json)
const DEFAULT_COMPACTION = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };

// Reads the `compaction` section of the pi user config (~/.pi/config.json):
// the property pi.dev uses for auto-compaction (threshold = contextWindow − reserveTokens)
export function readCompactionSettings(): CompactionSettings {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "config.json"), "utf8");
    const conf = JSON.parse(raw) as {
      compaction?: Partial<CompactionSettings>;
    };
    return {
      enabled: conf.compaction?.enabled ?? DEFAULT_COMPACTION.enabled,
      reserveTokens: conf.compaction?.reserveTokens ?? DEFAULT_COMPACTION.reserveTokens,
      keepRecentTokens:
        conf.compaction?.keepRecentTokens ?? DEFAULT_COMPACTION.keepRecentTokens,
    };
  } catch {
    return { ...DEFAULT_COMPACTION };
  }
}

export function userConfigDir(platform: NodeJS.Platform = process.platform): string {
  const home = homedir();
  switch (platform) {
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "pi-webview")
        : join(home, "AppData", "Roaming", "pi-webview");
    case "darwin":
      return join(home, "Library", "Application Support", "pi-webview");
    default:
      return process.env.XDG_CONFIG_HOME
        ? join(process.env.XDG_CONFIG_HOME, "pi-webview")
        : join(home, ".config", "pi-webview");
  }
}

export class ConfigStore {
  private config: UserConfig;
  private dir: string;

  constructor(dir: string = userConfigDir()) {
    this.dir = dir;
    this.config = this.read();
  }

  private configPath(): string {
    return join(this.dir, "config.json");
  }

  private read(): UserConfig {
    try {
      const raw = readFileSync(this.configPath(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<UserConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  get(): UserConfig {
    return { ...this.config };
  }

  patch(patch: Partial<UserConfig>): UserConfig {
    this.config = { ...this.config, ...patch };
    this.write();
    return this.get();
  }

  private write(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = this.configPath() + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.config, null, 2) + "\n");
    renameSync(tmp, this.configPath());
  }
}

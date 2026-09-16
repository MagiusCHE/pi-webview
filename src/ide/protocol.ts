import type {
  BrowserPageAction,
  BrowserPersistentPermissions,
  BrowserToolOperation,
  BrowserToolPayload,
} from "./browser-tools.ts";

// IDE bridge protocol — shared contracts UI ↔ host (concept 0002 D3).
// The wire format is identical both via WebSocket (standalone, bridge) and via
// postMessage (VS Code webview): only the transport changes.

// Container of every message exchanged between UI and host.
export type Frame =
  | { channel: "rpc"; payload: RpcCommand | RpcEvent }
  | { channel: "ide"; payload: IdeRequest | IdeResponse | IdeEvent };

// ---------------------------------------------------------------------------
// pi RPC: commands (UI → host → pi stdin)
// ---------------------------------------------------------------------------

export type RpcCommand = { type: string; id?: string } & Record<string, unknown>;

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export const rpc = {
  prompt(
    message: string,
    opts?: {
      images?: ImageContent[];
      streamingBehavior?: "steer" | "followUp";
      id?: string;
    },
  ): RpcCommand {
    return {
      type: "prompt",
      message,
      ...(opts?.images ? { images: opts.images } : {}),
      ...(opts?.streamingBehavior ? { streamingBehavior: opts.streamingBehavior } : {}),
      ...(opts?.id ? { id: opts.id } : {}),
    };
  },
  steer(message: string, images?: ImageContent[]): RpcCommand {
    return { type: "steer", message, ...(images ? { images } : {}) };
  },
  followUp(message: string, images?: ImageContent[]): RpcCommand {
    return { type: "follow_up", message, ...(images ? { images } : {}) };
  },
  clearQueue(): RpcCommand {
    return { type: "clear_queue" };
  },
  abort(): RpcCommand {
    return { type: "abort" };
  },
  getState(): RpcCommand {
    return { type: "get_state" };
  },
  getMessages(): RpcCommand {
    return { type: "get_messages" };
  },
  getSessionStats(): RpcCommand {
    return { type: "get_session_stats" };
  },
  getEntries(since?: string): RpcCommand {
    return since ? { type: "get_entries", since } : { type: "get_entries" };
  },
  getCommands(): RpcCommand {
    return { type: "get_commands" };
  },
  compact(): RpcCommand {
    return { type: "compact" };
  },
  newSession(): RpcCommand {
    return { type: "new_session" };
  },
  setModel(provider: string, modelId: string): RpcCommand {
    return { type: "set_model", provider, modelId };
  },
  setThinkingLevel(level: string): RpcCommand {
    return { type: "set_thinking_level", level };
  },
  getAvailableModels(): RpcCommand {
    return { type: "get_available_models" };
  },
  getAvailableThinkingLevels(): RpcCommand {
    return { type: "get_available_thinking_levels" };
  },
  setSteeringMode(mode: "all" | "one-at-a-time"): RpcCommand {
    return { type: "set_steering_mode", mode };
  },
  setFollowUpMode(mode: "all" | "one-at-a-time"): RpcCommand {
    return { type: "set_follow_up_mode", mode };
  },
  setAutoCompaction(enabled: boolean): RpcCommand {
    return { type: "set_auto_compaction", enabled };
  },
};

// ---------------------------------------------------------------------------
// pi RPC: events (pi stdout → host → UI)
// ---------------------------------------------------------------------------

export type RpcEvent = { type: string } & Record<string, unknown>;

export interface AssistantDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  /** partial proxy message: contains the tool name already in
   * toolcall_start (partial.content[contentIndex].name) */
  partial?: {
    content?: Array<{ type?: string; id?: string; name?: string }>;
  };
}

// ---------------------------------------------------------------------------
// IDE: requests from the UI to the host (attach selection, dialogs, ...)
// ---------------------------------------------------------------------------

export type IdeRequest =
  | { type: "attachSelection"; id?: string }
  | { type: "openFile"; path: string; id?: string }
  | { type: "showQuickPick"; items: string[]; title?: string; id?: string }
  | { type: "showInputBox"; title?: string; placeholder?: string; id?: string }
  | {
      type: "showMessage";
      message: string;
      kind?: "info" | "warning" | "error";
      id?: string;
    }
  | { type: "clipboardWrite"; text: string; id?: string }
  | { type: "workspaceInfo"; id?: string }
  | { type: "getConfig"; id?: string }
  | { type: "setConfig"; patch: Partial<UserConfig>; id?: string }
  | { type: "storeSession"; path: string; id?: string }
  | { type: "openNewChat"; id?: string }
  | { type: "getBalance"; provider: string; id?: string }
  | { type: "listSessions"; workspace?: string; id?: string }
  | { type: "getWorkspace"; id?: string }
  | { type: "getVersion"; id?: string }
  | { type: "getCliFlags"; sessionPath?: string; id?: string }
  | { type: "setCliFlags"; sessionPath?: string; flags: CliFlags; id?: string }
  | { type: "getSessionSettings"; sessionPath?: string; id?: string }
  | {
      type: "setSessionSettings";
      sessionPath?: string;
      settings: SessionSettings;
      id?: string;
    }
  | { type: "getStartupInfo"; id?: string }
  | { type: "listDir"; path: string; id?: string }
  | {
      type: "setWorkspace";
      path: string;
      action: "fork" | "new" | "resume";
      sessionPath?: string;
      id?: string;
    }
  | { type: "forkSession"; sourcePath: string; id?: string }
  | { type: "getTrust"; id?: string }
  | { type: "applyTrustOption"; option: TrustOptionId; id?: string }
  | {
      type: "saveAttachment";
      name: string;
      mimeType: string;
      dataBase64: string;
      id?: string;
    }
  | { type: "attachPath"; path: string; id?: string }
  | { type: "pickFile"; id?: string }
  | { type: "pathExists"; path: string; id?: string }
  | { type: "getSessionInfo"; path: string; id?: string }
  | { type: "getCompactionSettings"; id?: string }
  | { type: "getThinkingSettings"; id?: string }
  | { type: "getSettings"; key?: string; id?: string }
  | {
      type: "setSetting";
      key: string;
      value: unknown;
      /** force the write target for settings with scope "both" */
      scope?: "global" | "project";
      id?: string;
    }
  | { type: "setSettings"; settings: PiSettingChange[]; id?: string }
  | {
      type: "applySettings";
      settings: PiSettingChange[];
      flags?: CliFlags;
      sessionPath?: string;
      id?: string;
    }
  | { type: "renameSession"; path: string; name: string; id?: string }
  | { type: "deleteSession"; path: string; id?: string }
  | { type: "notifyDesktop"; title: string; body: string; id?: string }
  | { type: "debugNotify"; count: number; id?: string }
  | { type: "createBrowserHandoff"; id?: string }
  | {
      type: "browserToolResponse";
      requestId: string;
      result: BrowserToolPayload;
      id?: string;
    }
  /** restart the pi process (same path as applying CLI flags): the webview
   *  gets connection_closed(reason restart) + pi_restarted and re-initializes
   *  transparently, resuming the current session */
  | { type: "restartPi"; id?: string }
  /** host-driven webview reload (re-serve the document): the pi process
   *  survives, the page re-initializes from pi's live state */
  | { type: "reloadWebview"; id?: string };

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface ThinkingSettings {
  hideThinkingBlock: boolean;
}

// --- pi.dev settings facade (V1-bis of plan 0003) --------------------------
// The webview never talks to pi's settings files directly: it asks the host
// (get_settings), which builds the schema+values from a shared table
// (src/bridge/pi-settings.ts). pi.dev has no settings RPC, so the host
// simulates the facade; when pi.dev implements get_settings/set_settings it
// becomes a pass-through and the webview stays unchanged.

export type PiSettingSource = "pi-rpc" | "pi-settings-file" | "stub";

/** where set_setting is allowed to write (see plan 0003, "Scope di scrittura") */
export type PiSettingScope = "global" | "project" | "both" | "session";

export interface PiSettingOption {
  value: string;
  label: string;
}

export interface PiModelSettingValue {
  provider: string;
  id: string;
}

export interface PiSettingChange {
  key: string;
  value: unknown;
  /** force the write target for settings with scope "both" */
  scope?: "global" | "project";
}

export interface PiSetting {
  /** facade key (for pi-settings-file: the actual settings.json field name) */
  key: string;
  /** i18n key (it/en) for the row label */
  label: string;
  /** i18n key for the description tooltip */
  description?: string;
  /** optional i18n key for a visual sub-group in the settings section */
  group?: string;
  type: "boolean" | "number" | "enum" | "string" | "model";
  options?: PiSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  /** current value. Absent for source "pi-rpc": the webview fills it from
   *  get_state (the host has no RPC client — the webview talks to pi
   *  directly via the rpc channel). */
  value?: unknown;
  /** false → control disabled (stub or not yet writable) */
  writable: boolean;
  source: PiSettingSource;
  scope: PiSettingScope;
  /** what happens after a successful set (file-backed keys) */
  propagation?: "restart" | "none";
}

export interface PiSettingsResult {
  settings: PiSetting[];
  /** current pi workspace (for project-scoped settings) */
  workspace?: string;
  /** true → the workspace is trusted and can carry a project override */
  workspaceTrusted?: boolean;
}

export interface SessionInfo {
  path: string;
  id?: string;
  cwd?: string;
  name?: string;
  /** model selected on the active branch of the saved session */
  model?: { provider: string; id: string };
  firstMessage?: string;
  messageCount?: number;
  lastActivity?: number;
  /** timestamp of the last append-only entry recorded in the session */
  lastEventAt?: number;
  /** number of compaction entries recorded across the whole session */
  compactionCount?: number;
  /** on-disk size in bytes of the session JSONL file */
  sizeBytes?: number;
  mtime?: number;
}

export interface SessionListResult {
  sessions: SessionInfo[];
  workspace?: string;
}

export interface IdeResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

// --- Shared user config (D7) ------------------------------------------------
// In the VS Code webview the theme comes from the IDE (data-vscode-theme-kind / CSS
// vars --vscode-*); standalone uses the preference saved in config.json.

export type ThemePreference = "light" | "dark" | "system";

/** where the stats bar (context gauge + extension slots) lives */
export type StatsBarPosition = "above" | "below" | "topbar";

// --- pi launch CLI flags (settings block 3) ---------------------------------
// Available dynamically: they are the flags registered by pi and its
// extensions (e.g. --session-control of the pi-agent-extensions package): if
// the extension is not installed, the flag does not exist and does not appear.

export type CliFlagValue = boolean | string;

/** active values (flag → value), persisted per workspace */
export type CliFlags = Record<string, CliFlagValue>;

/** per-session overrides saved inside the session jsonl (see sessions.ts) */
export interface SessionSettings {
  /** notifications mode for THIS session only (absent → global default) */
  notifications?: "desktop" | "vscode" | "off";
  /** Browser operations authorized for the complete lifetime of this session. */
  browserToolPermissions?: BrowserToolOperation[];
}

/** one outdated npm package (pi core or an installed extension) */
export interface PackageUpdate {
  name: string;
  current: string;
  latest: string;
}

/** update check result (startup banner + header update button): `core`
 *  non-null when the pi core is outdated, `extensions` with a newer npm
 *  registry version. Present only when at least one of the two is non-empty
 *  (checked by the pi extension; absent/null → up-to-date or not finished). */
export interface UpdateAvailable {
  core: { current: string; latest: string } | null;
  extensions: PackageUpdate[];
}

/** loaded resources for the new-session welcome banner (Context/Skills/
 *  Extensions). NON-persistent: read from a per-process file (startup-info.ts),
 *  never part of the session jsonl. */
export interface StartupInfo {
  contextFiles: string[];
  skills: string[];
  extensions: string[];
  /** pi core and/or npm-installed extensions with a newer version
   *  (checked by the pi extension; absent/null → up-to-date or check not
   *  finished) */
  updateAvailable?: UpdateAvailable | null;
  /** unix ms of the last COMPLETED update check (live, no cache):
   *  absent → the check has not finished yet; the webview polls this
   *  timestamp to detect when a manual re-check (`/piw update.check`)
   *  landed */
  updateCheckedAt?: number;
}

/** description of a registered flag (from `pi --help` → Extension CLI Flags) */
export interface CliFlagInfo {
  name: string;
  type: "boolean" | "string";
  description?: string;
}

export type LocaleId = "it" | "en";

/** Project trust as pi applies it to protected project resources. pi never
 *  prompts in RPC mode, so a missing decision with defaultProjectTrust "ask"
 *  means those resources are ignored for that run: there is no third state. */
export type TrustStatus = "trusted" | "untrusted";

/** Options of the pi trust prompt (see pi core trust-manager, same order).
 *  "*-session" are NOT persisted: they launch pi with the per-run override
 *  flags `--approve` / `--no-approve`. */
export type TrustOptionId =
  "trust" | "trust-parent" | "trust-session" | "untrust" | "untrust-session";

export interface TrustOption {
  id: TrustOptionId;
  /** run-only override: true → `--approve`, false → `--no-approve` */
  sessionOverride?: boolean;
}

export interface TrustResult {
  /** status the RUNNING pi process was launched with */
  status: TrustStatus;
  workspace: string;
  /** parent folder offered by the "trust parent folder" option */
  parentPath?: string;
  /** a new decision waits for a pi restart to take effect */
  pendingRestart?: boolean;
  /** the running process uses a run-only override (not persisted) */
  sessionOnly?: boolean;
  /** options of the prompt (labels are localized by the webview) */
  options?: TrustOption[];
}

export interface UserConfig {
  theme: ThemePreference;
  locale?: LocaleId;
  /** max number of messages shown in history (resume and runtime) */
  historyLimit?: number;
  /** DEFAULT for NEW sessions: where turn-complete notifications go:
   *  desktop | vscode | off. Per-session overrides live INSIDE the session
   *  file (SessionSettings), not here. The "vscode" value only makes sense
   *  in the VS Code companion; in the browser only desktop/off are offered. */
  notifications?: "desktop" | "vscode" | "off";
  /** where the stats bar (context gauge + extension slots) lives:
   *  "above" (default) | "below" the composer, or "topbar" (second row of
   *  the header, under the sessions/gear row). Global, not per-session. */
  statsBarPosition?: StatsBarPosition;
  /** compact truncation (true) or multi-line wrapping (false), independently
   *  from the bar placement. Missing preserves the legacy placement behavior. */
  statsBarCompact?: boolean;
  /** group all thinking and tool calls of an agent run in one collapsible
   *  presentation block. Global UI preference; never persisted in sessions. */
  agenticThinking?: boolean;
  /** Webview-only security opt-in. When true, the `/piw update.pi.core.exts`
   *  child receives npm_config_allow_remote=all; no other process inherits it. */
  allowRemoteNpmUpdates?: boolean;
  /** Dangerous Webview-only opt-in. When true, the update child receives
   *  npm_config_dangerously_allow_all_scripts=true. */
  dangerouslyAllowAllNpmScripts?: boolean;
  /** Browser tool grants that outlive a session: exact origins and global. */
  browserToolPermissions?: BrowserPersistentPermissions;
  /** setStatus keys hidden by the user. RPC exposes the key as the stable
   *  identifier of the status source. */
  hiddenStatusKeys?: string[];
}

export type IdeEvent =
  | {
      type: "selection_changed";
      filePath?: string;
      workspaceFolder?: string;
      ranges?: SelectionRange[];
    }
  | { type: "selection_cleared"; reason?: string }
  | { type: "browser_context_changed"; context: BrowserPageContext }
  | { type: "browser_context_cleared"; reason?: string }
  | { type: "browser_handoff_adopted" }
  | {
      type: "browser_tool_request";
      requestId: string;
      operation: BrowserToolOperation;
      actions?: BrowserPageAction[];
      selector?: string;
    }
  | { type: "at_mentioned"; filePath?: string; rangeText?: string };

export interface BrowserSelectionRange {
  text: string;
}

export interface BrowserPageContext {
  url: string;
  title: string;
  faviconUrl?: string;
  ranges: BrowserSelectionRange[];
  documentId?: string;
  restricted?: boolean;
}

export interface SelectionRange {
  text: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export const ideResponse = (
  id: string,
  ok: boolean,
  data?: unknown,
  error?: string,
): IdeResponse => (ok ? { id, ok, data } : { id, ok, error });

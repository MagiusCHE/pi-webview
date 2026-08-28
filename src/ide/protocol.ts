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
  steer(message: string): RpcCommand {
    return { type: "steer", message };
  },
  followUp(message: string): RpcCommand {
    return { type: "follow_up", message };
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
  | { type: "setTrust"; status: TrustStatus; id?: string }
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
  | { type: "renameSession"; path: string; name: string; id?: string }
  | { type: "deleteSession"; path: string; id?: string }
  | { type: "storeSteerQueue"; items: SteerQueueItem[]; id?: string }
  | { type: "getSteerQueue"; id?: string }
  | { type: "notifyDesktop"; title: string; body: string; id?: string }
  | { type: "debugNotify"; count: number; id?: string };

/** queued message (steering): only persisted text (no images) */
export interface SteerQueueItem {
  text: string;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface ThinkingSettings {
  hideThinkingBlock: boolean;
}

export interface SessionInfo {
  path: string;
  id?: string;
  cwd?: string;
  name?: string;
  firstMessage?: string;
  messageCount?: number;
  lastActivity?: number;
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
}

/** loaded resources for the new-session welcome banner (Context/Skills/
 *  Extensions). NON-persistent: read from a per-process file (startup-info.ts),
 *  never part of the session jsonl. */
export interface StartupInfo {
  contextFiles: string[];
  skills: string[];
  extensions: string[];
}

/** description of a registered flag (from `pi --help` → Extension CLI Flags) */
export interface CliFlagInfo {
  name: string;
  type: "boolean" | "string";
  description?: string;
}

export type LocaleId = "it" | "en";

export type TrustStatus = "trusted" | "untrusted" | "ask";

export interface TrustResult {
  status: TrustStatus;
  workspace: string;
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
}

export type IdeEvent =
  | {
      type: "selection_changed";
      filePath?: string;
      workspaceFolder?: string;
      ranges?: SelectionRange[];
    }
  | { type: "selection_cleared"; reason?: string }
  | { type: "at_mentioned"; filePath?: string; rangeText?: string };

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

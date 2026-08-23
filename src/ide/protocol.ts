// IDE bridge protocol — contratti condivisi UI ↔ host (concept 0002 D3).
// Il wire format è identico sia via WebSocket (standalone, bridge) sia via
// postMessage (webview VS Code): cambia solo il trasporto.

// Contenitore di ogni messaggio scambiato tra UI e host.
export type Frame =
  | { channel: "rpc"; payload: RpcCommand | RpcEvent }
  | { channel: "ide"; payload: IdeRequest | IdeResponse | IdeEvent };

// ---------------------------------------------------------------------------
// pi RPC: comandi (UI → host → stdin di pi)
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
// pi RPC: eventi (stdout di pi → host → UI)
// ---------------------------------------------------------------------------

export type RpcEvent = { type: string } & Record<string, unknown>;

export interface AssistantDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  /** messaggio parziale del proxy: contiene il nome del tool già in
   * toolcall_start (partial.content[contentIndex].name) */
  partial?: {
    content?: Array<{ type?: string; id?: string; name?: string }>;
  };
}

// ---------------------------------------------------------------------------
// IDE: richieste della UI verso l'host (attach selection, dialoghi, ...)
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
  | { type: "listDir"; path: string; id?: string }
  | {
      type: "setWorkspace";
      path: string;
      action: "fork" | "new";
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
  | { type: "pathExists"; path: string; id?: string }
  | { type: "getSessionInfo"; path: string; id?: string }
  | { type: "getCompactionSettings"; id?: string }
  | { type: "renameSession"; path: string; name: string; id?: string }
  | { type: "deleteSession"; path: string; id?: string }
  | { type: "storeSteerQueue"; items: SteerQueueItem[]; id?: string }
  | { type: "getSteerQueue"; id?: string };

/** messaggio accodato (stearing): solo testo persistito (le immagini no) */
export interface SteerQueueItem {
  text: string;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
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

// --- Config utente condivisa (D7) -------------------------------------------
// In webview VS Code il tema arriva dall'IDE (data-vscode-theme-kind / CSS
// vars --vscode-*); standalone si usa la preferenza salvata in config.json.

export type ThemePreference = "light" | "dark" | "system";

export type LocaleId = "it" | "en";

export type TrustStatus = "trusted" | "untrusted" | "ask";

export interface TrustResult {
  status: TrustStatus;
  workspace: string;
}

export interface UserConfig {
  theme: ThemePreference;
  locale?: LocaleId;
  /** numero massimo di messaggi mostrati in cronologia (resume e runtime) */
  historyLimit?: number;
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

import type { BrowserPageContext } from "../../ide/protocol.ts";
import {
  BrowserConnectionError,
  DEFAULT_BROWSER_SERVER_URL,
  discoverBrowserBridge,
  parseBrowserServerUrl,
} from "./connection.ts";

const SERVER_URL_KEY = "serverUrl";
const SESSION_INTENT_KEY = "sessionIntent";
const PANEL_PORT = "pi-webview-side-panel";
const SESSION_INTENT_KEYS = ["s", "session", "new", "launch"] as const;

interface ChromeStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

interface ChromeRuntime {
  id?: string;
  connect(info: { name: string }): ChromePort;
}

interface ChromePermissions {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

interface ChromeApi {
  runtime?: ChromeRuntime;
  storage?: { local?: ChromeStorageArea };
  permissions?: ChromePermissions;
  windows?: { getCurrent(): Promise<{ id?: number }> };
}

export interface BrowserPanelMessage {
  type: string;
  context?: BrowserPageContext;
  error?: string;
  result?: Record<string, unknown>;
}

export function browserApi(): ChromeApi | null {
  const value = (globalThis as unknown as { chrome?: ChromeApi }).chrome;
  return value?.runtime?.id ? value : null;
}

export function isBrowserExtensionRuntime(): boolean {
  return location.protocol === "chrome-extension:" && browserApi() !== null;
}

export function browserConfiguredServerUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_BROWSER_SERVER_URL;
  const target = parseBrowserServerUrl(trimmed);
  const url = new URL(target.serverUrl);
  const hadHash = new URL(trimmed).hash.length > 0;
  for (const key of SESSION_INTENT_KEYS) url.searchParams.delete(key);
  url.hash = "";
  return target.pageIntent || hadHash ? url.toString() : trimmed;
}

export function browserSessionIntentFromServerUrl(value: string): string {
  return parseBrowserServerUrl(value).pageIntent;
}

function normalizeBrowserSessionIntent(value: unknown): string {
  if (typeof value !== "string") return "";
  const input = new URLSearchParams(value);
  const output = new URLSearchParams();
  for (const key of SESSION_INTENT_KEYS) {
    for (const item of input.getAll(key)) output.append(key, item);
  }
  return output.toString();
}

async function getBrowserConnectionStorage(): Promise<{
  serverUrl: string;
  sessionIntent: string;
}> {
  const storage = browserApi()?.storage?.local;
  if (!storage) {
    return { serverUrl: DEFAULT_BROWSER_SERVER_URL, sessionIntent: "" };
  }
  const values = await storage.get([SERVER_URL_KEY, SESSION_INTENT_KEY]);
  const raw =
    typeof values[SERVER_URL_KEY] === "string" && values[SERVER_URL_KEY].trim()
      ? values[SERVER_URL_KEY]
      : DEFAULT_BROWSER_SERVER_URL;
  const serverUrl = browserConfiguredServerUrl(raw);
  const migratedIntent = browserSessionIntentFromServerUrl(raw);
  const hasStoredIntent = typeof values[SESSION_INTENT_KEY] === "string";
  const sessionIntent = hasStoredIntent
    ? normalizeBrowserSessionIntent(values[SESSION_INTENT_KEY])
    : migratedIntent;
  if (serverUrl !== raw || (!hasStoredIntent && migratedIntent)) {
    await storage.set({
      [SERVER_URL_KEY]: serverUrl,
      [SESSION_INTENT_KEY]: sessionIntent,
    });
  }
  return { serverUrl, sessionIntent };
}

export async function getBrowserServerUrl(): Promise<string> {
  return (await getBrowserConnectionStorage()).serverUrl;
}

export async function setBrowserServerUrl(value: string): Promise<string> {
  const normalized = browserConfiguredServerUrl(value);
  const storage = browserApi()?.storage?.local;
  if (!storage) {
    throw new BrowserConnectionError(
      "storage-unavailable",
      "Browser extension storage is unavailable.",
    );
  }
  await storage.set({ [SERVER_URL_KEY]: normalized });
  return normalized;
}

export function browserServerUrlWithSession(
  serverUrl: string,
  sessionId: string,
): string {
  const url = new URL(parseBrowserServerUrl(serverUrl).serverUrl);
  url.searchParams.delete("new");
  url.searchParams.delete("session");
  url.searchParams.delete("launch");
  url.searchParams.set("s", sessionId);
  return url.toString();
}

export function browserServerUrlWithNewSession(serverUrl: string): string {
  const url = new URL(parseBrowserServerUrl(serverUrl).serverUrl);
  url.searchParams.delete("s");
  url.searchParams.delete("session");
  url.searchParams.delete("launch");
  url.searchParams.set("new", "1");
  return url.toString();
}

async function persistBrowserSessionIntent(
  sessionIntent: string,
  api: ChromeApi | null,
): Promise<string> {
  const storage = api?.storage?.local;
  if (!storage) {
    throw new BrowserConnectionError(
      "storage-unavailable",
      "Browser extension storage is unavailable.",
    );
  }
  const normalized = normalizeBrowserSessionIntent(sessionIntent);
  await storage.set({ [SESSION_INTENT_KEY]: normalized });
  return normalized;
}

export async function persistBrowserServerSession(
  sessionId: string,
  api: ChromeApi | null = browserApi(),
): Promise<string> {
  return persistBrowserSessionIntent(`s=${encodeURIComponent(sessionId)}`, api);
}

export async function persistBrowserServerNewSessionIntent(
  api: ChromeApi | null = browserApi(),
): Promise<string> {
  return persistBrowserSessionIntent("new=1", api);
}

async function ensureServerPermission(serverUrl: string): Promise<void> {
  const permissions = browserApi()?.permissions;
  if (!permissions) return;
  const url = new URL(serverUrl);
  const originPattern = `${url.protocol}//${url.host}/*`;
  if (await permissions.contains({ origins: [originPattern] })) return;
  const granted = await permissions.request({ origins: [originPattern] });
  if (!granted) {
    throw new BrowserConnectionError(
      "permission-denied",
      "Permission to connect to the configured server was denied.",
    );
  }
}

export function browserServerUrlWithPanelIntent(
  serverUrl: string,
  panelSearch: string,
): string {
  const url = new URL(serverUrl);
  const panel = new URLSearchParams(panelSearch);
  const intentKeys = ["s", "session", "new", "launch"];
  if (intentKeys.some((key) => panel.has(key))) {
    for (const key of intentKeys) url.searchParams.delete(key);
    for (const key of intentKeys) {
      for (const value of panel.getAll(key)) url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

export function browserClientWebSocketUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set("client", "browser");
  return url.toString();
}

export async function resolveBrowserExtensionBridgeUrl(
  value?: string,
): Promise<{ serverUrl: string; wsUrl: string }> {
  const connectionStorage = await getBrowserConnectionStorage();
  const configuredUrl = value
    ? browserConfiguredServerUrl(value)
    : connectionStorage.serverUrl;
  const persistedUrl = browserServerUrlWithPanelIntent(
    configuredUrl,
    connectionStorage.sessionIntent ? `?${connectionStorage.sessionIntent}` : "",
  );
  const serverUrl = browserServerUrlWithPanelIntent(persistedUrl, location.search);
  await ensureServerPermission(serverUrl);
  const connection = await discoverBrowserBridge(serverUrl);
  const browserWsUrl = browserClientWebSocketUrl(connection.wsUrl);
  const storage = browserApi()?.storage?.local;
  const stored = storage ? await storage.get("pendingHandoff") : {};
  const pending = stored.pendingHandoff as
    { ticket?: unknown; createdAt?: unknown; windowId?: unknown } | undefined;
  const currentWindow: { id?: number } | undefined = await browserApi()
    ?.windows?.getCurrent()
    .catch(() => undefined);
  const belongsToCurrentWindow =
    typeof pending?.windowId !== "number" ||
    currentWindow?.id === undefined ||
    pending.windowId === currentWindow.id;
  if (
    belongsToCurrentWindow &&
    typeof pending?.ticket === "string" &&
    typeof pending.createdAt === "number" &&
    Date.now() - pending.createdAt <= 30_000
  ) {
    const wsUrl = new URL(browserWsUrl);
    wsUrl.searchParams.set("handoff", pending.ticket);
    return { ...connection, wsUrl: wsUrl.toString() };
  }
  if (
    pending &&
    storage &&
    typeof pending.createdAt === "number" &&
    Date.now() - pending.createdAt > 30_000
  ) {
    await storage.remove("pendingHandoff");
  }
  return { ...connection, wsUrl: browserWsUrl };
}

export function connectBrowserPanel(
  onMessage: (message: BrowserPanelMessage) => void,
  api: ChromeApi | null = browserApi(),
  reconnectDelayMs = 250,
): { send(message: unknown): void; dispose(): void } | null {
  const runtime = api?.runtime;
  if (!runtime) return null;
  const panelRuntime: ChromeRuntime = runtime;

  let port: ChromePort | null = null;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingMessages: unknown[] = [];

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const markDisconnected = (candidate: ChromePort) => {
    if (port !== candidate) return;
    port = null;
    scheduleReconnect();
  };

  const post = (candidate: ChromePort, message: unknown): boolean => {
    try {
      candidate.postMessage(message);
      return true;
    } catch {
      markDisconnected(candidate);
      return false;
    }
  };

  const announceReady = async (candidate: ChromePort) => {
    try {
      const current = await api.windows?.getCurrent();
      if (port !== candidate) return;
      post(candidate, { type: "panel_ready", windowId: current?.id });
    } catch {
      if (port === candidate) post(candidate, { type: "panel_ready" });
    }
  };

  function connect(): void {
    if (disposed) return;
    let candidate: ChromePort;
    try {
      candidate = panelRuntime.connect({ name: PANEL_PORT });
    } catch {
      scheduleReconnect();
      return;
    }
    port = candidate;
    candidate.onMessage.addListener((message) => {
      if (port === candidate && message && typeof message === "object") {
        onMessage(message as BrowserPanelMessage);
      }
    });
    candidate.onDisconnect.addListener(() => markDisconnected(candidate));
    void announceReady(candidate).then(() => {
      if (port !== candidate) return;
      while (pendingMessages.length > 0) {
        const message = pendingMessages.shift();
        if (!post(candidate, message)) {
          if (message !== undefined) pendingMessages.unshift(message);
          break;
        }
      }
    });
  }

  connect();
  return {
    send(message) {
      const current = port;
      if (current && post(current, message)) return;
      pendingMessages.push(message);
      if (pendingMessages.length > 64) pendingMessages.shift();
      scheduleReconnect();
    },
    dispose() {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      pendingMessages.length = 0;
      const current = port;
      port = null;
      current?.disconnect();
    },
  };
}

export const BROWSER_PANEL_PORT = PANEL_PORT;

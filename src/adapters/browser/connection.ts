import { bridgeUrlWithPageIntent } from "../../web/session-url.ts";

export const DEFAULT_BROWSER_SERVER_URL = "http://127.0.0.1:7361";

export interface BrowserConnectionTarget {
  serverUrl: string;
  configUrl: string;
  pageIntent: string;
}

export interface BrowserBridgeConfig {
  wsUrl?: string;
  product?: string;
  protocolVersion?: number;
}

export type BrowserConnectionErrorCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "unreachable"
  | "unauthorized"
  | "not-piw"
  | "invalid-config"
  | "permission-denied"
  | "storage-unavailable";

export class BrowserConnectionError extends Error {
  readonly code: BrowserConnectionErrorCode;

  constructor(code: BrowserConnectionErrorCode, message: string) {
    super(message);
    this.name = "BrowserConnectionError";
    this.code = code;
  }
}

const INTENT_KEYS = new Set(["s", "session", "new", "launch"]);

export function parseBrowserServerUrl(value: string): BrowserConnectionTarget {
  let url: URL;
  try {
    url = new URL(value.trim() || DEFAULT_BROWSER_SERVER_URL);
  } catch {
    throw new BrowserConnectionError("invalid-url", "The server URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserConnectionError(
      "unsupported-scheme",
      "The server URL must use http:// or https://.",
    );
  }

  url.hash = "";
  const pageIntent = new URLSearchParams();
  for (const [key, item] of url.searchParams) {
    if (INTENT_KEYS.has(key)) pageIntent.append(key, item);
  }

  const configUrl = new URL("/bridge-config.json", url);
  for (const [key, item] of url.searchParams) {
    if (!INTENT_KEYS.has(key)) configUrl.searchParams.append(key, item);
  }

  return {
    serverUrl: url.toString(),
    configUrl: configUrl.toString(),
    pageIntent: pageIntent.toString(),
  };
}

export async function discoverBrowserBridge(
  value: string,
  fetcher: typeof fetch = fetch,
): Promise<{ serverUrl: string; wsUrl: string }> {
  const target = parseBrowserServerUrl(value);
  let response: Response;
  try {
    response = await fetcher(target.configUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    throw new BrowserConnectionError("unreachable", "The piw server is unreachable.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new BrowserConnectionError(
      "unauthorized",
      "The piw server rejected the authentication token.",
    );
  }
  if (!response.ok) {
    throw new BrowserConnectionError(
      "not-piw",
      `The server did not return a piw bridge configuration (HTTP ${response.status}).`,
    );
  }

  let config: BrowserBridgeConfig;
  try {
    config = (await response.json()) as BrowserBridgeConfig;
  } catch {
    throw new BrowserConnectionError("invalid-config", "The server response is invalid.");
  }
  if (!config.wsUrl || typeof config.wsUrl !== "string") {
    throw new BrowserConnectionError(
      "invalid-config",
      "The server response does not contain a WebSocket URL.",
    );
  }
  if (config.product !== "pi-webview") {
    throw new BrowserConnectionError("not-piw", "The endpoint is not a piw server.");
  }

  return {
    serverUrl: target.serverUrl,
    wsUrl: bridgeUrlWithPageIntent(config.wsUrl, target.pageIntent),
  };
}

export function redactBrowserServerUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? "?…" : ""}${url.hash ? "#…" : ""}`;
  } catch {
    return "<invalid URL>";
  }
}

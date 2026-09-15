import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

export const BROWSER_CONTROL_URL_ENV = "PI_WEBVIEW_BROWSER_CONTROL_URL";
export const BROWSER_CONTROL_CAPABILITY_ENV = "PI_WEBVIEW_BROWSER_CONTROL_CAPABILITY";

export type BrowserToolOperation = "dom" | "screenshot";

export interface BrowserToolResponse {
  ok: boolean;
  operation?: BrowserToolOperation;
  url?: string;
  title?: string;
  documentId?: string;
  html?: string;
  imageDataUrl?: string;
  error?: string;
}

interface ToolContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

interface ToolResult {
  content: ToolContent[];
  details: Record<string, unknown>;
}

export interface BrowserToolPiApi {
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    promptGuidelines: string[];
    parameters: ReturnType<typeof Type.Object>;
    execute(
      toolCallId: string,
      params: Record<string, never>,
      signal: AbortSignal | undefined,
    ): Promise<ToolResult>;
  }): void;
}

const INLINE_DOM_BYTES = 45_000;
const TEMP_TTL_MS = 24 * 60 * 60_000;

export async function requestBrowserTool(
  operation: BrowserToolOperation,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<BrowserToolResponse> {
  const url = env[BROWSER_CONTROL_URL_ENV];
  const capability = env[BROWSER_CONTROL_CAPABILITY_ENV];
  if (!url || !capability) {
    throw new Error("Browser tools are available only in a piw browser session.");
  }
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-webview-browser-capability": capability,
    },
    body: JSON.stringify({ operation }),
    signal,
  });
  let result: BrowserToolResponse;
  try {
    result = (await response.json()) as BrowserToolResponse;
  } catch {
    throw new Error(`The browser control bridge returned HTTP ${response.status}.`);
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Browser ${operation} failed.`);
  }
  return result;
}

function browserTempDir(): string {
  return join(tmpdir(), "pi-webview-browser");
}

function cleanupBrowserTemp(directory: string, now = Date.now()): void {
  try {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (now - statSync(path).mtimeMs > TEMP_TTL_MS) rmSync(path, { force: true });
    }
  } catch {
    // Best effort only: capture must not fail because cleanup was unavailable.
  }
}

export function domToolResult(result: BrowserToolResponse): ToolResult {
  const html = result.html ?? "";
  const bytes = Buffer.byteLength(html);
  const metadata = `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}`;
  if (bytes <= INLINE_DOM_BYTES) {
    return {
      content: [{ type: "text", text: `${metadata}\n\n${html}` }],
      details: { operation: "dom", bytes, url: result.url, title: result.title },
    };
  }
  const directory = browserTempDir();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  cleanupBrowserTemp(directory);
  const path = join(directory, `page-${randomUUID()}.html`);
  writeFileSync(path, html, { encoding: "utf8", mode: 0o600 });
  const excerpt = Buffer.from(html).subarray(0, INLINE_DOM_BYTES).toString("utf8");
  return {
    content: [
      {
        type: "text",
        text: `${metadata}\nDOM size: ${bytes} bytes. The complete DOM was saved to ${path}.\n\n${excerpt}\n\n[Inline DOM excerpt truncated; use read with offsets on the file above.]`,
      },
    ],
    details: { operation: "dom", bytes, path, url: result.url, title: result.title },
  };
}

export function screenshotToolResult(result: BrowserToolResponse): ToolResult {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(
    result.imageDataUrl ?? "",
  );
  if (!match?.[1] || !match[2])
    throw new Error("The browser returned an invalid screenshot.");
  return {
    content: [
      {
        type: "text",
        text: `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}`,
      },
      { type: "image", mimeType: match[1], data: match[2].replace(/\s/g, "") },
    ],
    details: { operation: "screenshot", url: result.url, title: result.title },
  };
}

export function registerBrowserTools(pi: BrowserToolPiApi): void {
  const parameters = Type.Object({}, { additionalProperties: false });
  pi.registerTool({
    name: "browser_page_dom",
    label: "Browser Page DOM",
    description:
      "Read the complete serialized DOM of the web page associated with the pi-webview browser side panel.",
    promptSnippet: "Read the active browser page DOM",
    promptGuidelines: [
      "Use browser_page_dom when the user's request depends on page structure or content that is not present in the visible browser context.",
    ],
    parameters,
    async execute(_toolCallId, _params, signal) {
      return domToolResult(await requestBrowserTool("dom", signal));
    },
  });
  pi.registerTool({
    name: "browser_page_screenshot",
    label: "Browser Page Screenshot",
    description:
      "Capture the visible viewport of the web page associated with the pi-webview browser side panel.",
    promptSnippet: "Capture the active browser page viewport",
    promptGuidelines: [
      "Use browser_page_screenshot when the user's request depends on the visual appearance of the active browser page.",
    ],
    parameters,
    async execute(_toolCallId, _params, signal) {
      return screenshotToolResult(await requestBrowserTool("screenshot", signal));
    },
  });
}

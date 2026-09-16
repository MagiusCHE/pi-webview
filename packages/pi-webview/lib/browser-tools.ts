import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  normalizeBrowserPageActions,
  type BrowserPageAction,
  type BrowserToolOperation,
  type BrowserToolPayload,
} from "../../../src/ide/browser-tools.ts";

export const BROWSER_CONTROL_URL_ENV = "PI_WEBVIEW_BROWSER_CONTROL_URL";
export const BROWSER_CONTROL_CAPABILITY_ENV = "PI_WEBVIEW_BROWSER_CONTROL_CAPABILITY";

export type BrowserToolResponse = BrowserToolPayload;

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
      params: Record<string, unknown>,
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
  actions?: BrowserPageAction[],
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
    body: JSON.stringify({ operation, ...(actions ? { actions } : {}) }),
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

export function actionToolResult(result: BrowserToolResponse): ToolResult {
  const actionResults = result.actionResults ?? [];
  const completed = actionResults.filter((item) => item.ok).length;
  const failures = actionResults
    .filter((item) => !item.ok)
    .map((item) => `Action ${item.index + 1} (${item.type}): ${item.error || "failed"}`);
  const metadata = `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}`;
  return {
    content: [
      {
        type: "text",
        text: `${metadata}\nCompleted ${completed} of ${actionResults.length} actions.${failures.length > 0 ? `\n${failures.join("\n")}` : ""}`,
      },
    ],
    details: {
      operation: "action",
      url: result.url,
      title: result.title,
      actionResults,
    },
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

  const selector = Type.String({
    minLength: 1,
    maxLength: 2_000,
    description: "CSS selector identifying the target element",
  });
  const action = Type.Union([
    Type.Object(
      { type: Type.Literal("click"), selector },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("type"),
        selector,
        text: Type.String({ maxLength: 100_000 }),
        clear: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("select"),
        selector,
        value: Type.String({ maxLength: 100_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal("focus"), selector },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("scroll"),
        selector: Type.Optional(selector),
        deltaX: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
        deltaY: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
      },
      { additionalProperties: false },
    ),
  ]);
  pi.registerTool({
    name: "browser_page_action",
    label: "Browser Page Action",
    description:
      "Interact with the active browser page using a confirmed sequence of structured actions. Supports click, type, select, focus and scroll; it does not execute arbitrary JavaScript.",
    promptSnippet: "Interact with the active browser page",
    promptGuidelines: [
      "Use browser_page_dom first when selectors are unknown.",
      "Use browser_page_action only when the user asks to interact with the page. Every action sequence requires explicit user confirmation in the side panel.",
      "Do not click controls that publish, submit, purchase, delete or otherwise cause an external side effect unless the user explicitly requested that outcome.",
    ],
    parameters: Type.Object(
      { actions: Type.Array(action, { minItems: 1, maxItems: 20 }) },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const actions = normalizeBrowserPageActions(params.actions);
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });
}

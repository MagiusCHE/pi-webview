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
  selector?: string,
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
    body: JSON.stringify({
      operation,
      ...(actions ? { actions } : {}),
      ...(selector ? { selector } : {}),
    }),
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
      details: {
        operation: "dom",
        bytes,
        url: result.url,
        title: result.title,
        ...(result.selector ? { selector: result.selector } : {}),
      },
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
    details: {
      operation: "dom",
      bytes,
      path,
      url: result.url,
      title: result.title,
      ...(result.selector ? { selector: result.selector } : {}),
    },
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
  const selector = Type.String({
    minLength: 1,
    maxLength: 2_000,
    description: "CSS selector identifying the target element",
  });
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
    name: "browser_page_element_dom",
    label: "Browser Page Element DOM",
    description:
      "Read the serialized outer HTML of one element in the active browser page without capturing the complete document.",
    promptSnippet: "Read one active browser page element",
    promptGuidelines: [
      "Prefer browser_page_element_dom over browser_page_dom when the target selector is already known.",
      "Use browser_page_dom only when the relevant selector cannot be determined from available context.",
    ],
    parameters: Type.Object({ selector }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal) {
      return domToolResult(
        await requestBrowserTool(
          "dom",
          signal,
          process.env,
          fetch,
          undefined,
          String(params.selector),
        ),
      );
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

  const classChange = Type.Object(
    {
      selector,
      add: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          minItems: 1,
          maxItems: 100,
        }),
      ),
      remove: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          minItems: 1,
          maxItems: 100,
        }),
      ),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "browser_page_class",
    label: "Browser Page CSS Classes",
    description:
      "Add or remove CSS class tokens on selected elements in the active browser page using structured, confirmed mutations.",
    promptSnippet: "Change CSS classes on active browser page elements",
    promptGuidelines: [
      "Use browser_page_class when an element must gain or lose existing page behavior represented by CSS class names.",
      "Prefer explicit add and remove lists; this tool does not execute JavaScript or create stylesheet rules.",
    ],
    parameters: Type.Object(
      { changes: Type.Array(classChange, { minItems: 1, maxItems: 20 }) },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const changes = Array.isArray(params.changes) ? params.changes : [];
      const actions = normalizeBrowserPageActions(
        changes.map((change) => ({
          ...(change as Record<string, unknown>),
          type: "class",
        })),
      );
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });

  const styleValue = Type.Object(
    {
      property: Type.String({ minLength: 1, maxLength: 128 }),
      value: Type.String({ maxLength: 2_000 }),
      priority: Type.Optional(Type.Literal("important")),
    },
    { additionalProperties: false },
  );
  const styleChange = Type.Object(
    {
      selector,
      set: Type.Optional(Type.Array(styleValue, { minItems: 1, maxItems: 100 })),
      remove: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
          minItems: 1,
          maxItems: 100,
        }),
      ),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "browser_page_style",
    label: "Browser Page Inline Styles",
    description:
      "Set or remove inline CSS properties on selected elements in the active browser page using structured, confirmed mutations.",
    promptSnippet: "Change inline styles on active browser page elements",
    promptGuidelines: [
      "Use browser_page_style when an element must be exposed, hidden, positioned or made interactive through inline CSS.",
      "Remove temporary inline properties after the interaction when they are no longer needed.",
      "This tool does not execute JavaScript or modify stylesheet rules.",
    ],
    parameters: Type.Object(
      { changes: Type.Array(styleChange, { minItems: 1, maxItems: 20 }) },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const changes = Array.isArray(params.changes) ? params.changes : [];
      const actions = normalizeBrowserPageActions(
        changes.map((change) => ({
          ...(change as Record<string, unknown>),
          type: "style",
        })),
      );
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });

  const clickTarget = Type.Union([Type.Literal("selector"), Type.Literal("visual")]);
  pi.registerTool({
    name: "browser_page_click",
    label: "Browser Page Click",
    description:
      "Click the visual element covering a selected control, click the selected element itself, or use viewport CSS coordinates as a controlled fallback.",
    promptSnippet: "Click a browser page control by visual hit-test or coordinates",
    promptGuidelines: [
      "Prefer a selector with target visual so the page is scrolled and the element actually painted at its center receives the event, including sibling overlays.",
      "Use target selector only when the selected DOM node itself must receive the click.",
      "Use x and y only as a fallback when a reliable selector is unavailable. Coordinates are CSS pixels from the current viewport's top-left corner and must come from current page evidence.",
      "Clicks are structured synthetic page events, not trusted native input; this tool never uses Chrome debugger or CDP.",
    ],
    parameters: Type.Object(
      {
        selector: Type.Optional(selector),
        target: Type.Optional(clickTarget),
        x: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
        y: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const hasSelector = typeof params.selector === "string";
      const hasCoordinates = params.x !== undefined || params.y !== undefined;
      if (hasSelector && hasCoordinates) {
        throw new Error("Provide either a selector or x/y coordinates, not both.");
      }
      if (!hasSelector && params.target !== undefined) {
        throw new Error("target can be used only with selector.");
      }
      const actions = normalizeBrowserPageActions([
        hasSelector
          ? {
              type: "click",
              selector: params.selector,
              target: params.target ?? "visual",
            }
          : { type: "click_at", x: params.x, y: params.y },
      ]);
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });

  pi.registerTool({
    name: "browser_page_navigation",
    label: "Browser Page Navigation",
    description:
      "Reload the active browser page or navigate its tab to an absolute HTTP or HTTPS URL without executing page JavaScript.",
    promptSnippet: "Reload or navigate the active browser page",
    promptGuidelines: [
      "Use browser_page_navigation only when the user asks to reload the page or open a specific URL in the active tab.",
      "Navigation is an external page action and requires an applicable action authorization.",
      "Only absolute HTTP and HTTPS URLs are accepted.",
    ],
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal("reload"), Type.Literal("navigate")]),
        url: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 8_192,
            description: "Absolute HTTP or HTTPS URL required for navigate",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const actions = normalizeBrowserPageActions([
        params.action === "reload"
          ? { type: "reload" }
          : { type: "navigate", url: params.url },
      ]);
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });

  const scrollPosition = Type.Union([
    Type.Literal("start"),
    Type.Literal("center"),
    Type.Literal("end"),
    Type.Literal("nearest"),
  ]);
  pi.registerTool({
    name: "browser_page_scroll",
    label: "Browser Page Scroll",
    description:
      "Scroll the active page by a bounded delta, scroll a container, or bring a selected element into view.",
    promptSnippet: "Scroll the active browser page or reveal an element",
    promptGuidelines: [
      "Use deltaX or deltaY without a selector to scroll the page.",
      "Use a selector without deltas to bring that element into view; block and inline control its alignment.",
      "Use a selector with deltas only to scroll that element as a container.",
    ],
    parameters: Type.Object(
      {
        selector: Type.Optional(selector),
        deltaX: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
        deltaY: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
        block: Type.Optional(scrollPosition),
        inline: Type.Optional(scrollPosition),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const actions = normalizeBrowserPageActions([{ type: "scroll", ...params }]);
      return actionToolResult(
        await requestBrowserTool("action", signal, process.env, fetch, actions),
      );
    },
  });

  const action = Type.Union([
    Type.Object(
      {
        type: Type.Literal("click"),
        selector,
        target: Type.Optional(clickTarget),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("click_at"),
        x: Type.Number({ minimum: 0, maximum: 100_000 }),
        y: Type.Number({ minimum: 0, maximum: 100_000 }),
      },
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
        block: Type.Optional(scrollPosition),
        inline: Type.Optional(scrollPosition),
      },
      { additionalProperties: false },
    ),
  ]);
  pi.registerTool({
    name: "browser_page_action",
    label: "Browser Page Action",
    description:
      "Interact with the active browser page using a confirmed sequence of structured actions. Supports selector/visual/coordinate click, type, select, focus and scroll; it does not execute arbitrary JavaScript or use Chrome debugger.",
    promptSnippet: "Interact with the active browser page",
    promptGuidelines: [
      "Use browser_page_dom first when selectors are unknown, then prefer browser_page_element_dom for targeted follow-up reads.",
      "Use browser_page_action only when the user asks to interact with the page. Prefer browser_page_click, browser_page_navigation and browser_page_scroll for those dedicated operations. An applicable action authorization is required in the side panel.",
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

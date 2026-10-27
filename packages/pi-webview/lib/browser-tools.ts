import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  COMPANION_PROTOCOL_VERSION,
  normalizeBrowserEditorRequest,
  normalizeBrowserExpectedHost,
  normalizeBrowserPageActions,
  normalizeBrowserScriptRequest,
  type BrowserDomMode,
  type BrowserEditorRequest,
  type BrowserPageAction,
  type BrowserPageToolOperation,
  type BrowserScriptRequest,
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

/**
 * Rejects results from an older Chrome companion build. Without this check a
 * missing field (e.g. a compact DOM that was never produced) would be rendered
 * as an empty but successful answer.
 */
export function requireCompanionProtocol(
  result: BrowserToolResponse,
  minimum: number,
  feature: string,
): void {
  const version = result.companionProtocol ?? 0;
  if (version >= minimum) return;
  throw new Error(
    `${feature} is not supported by the running pi-webview Chrome companion (protocol ${version}, required ${minimum}). ` +
      "The pi package is newer than the extension: open chrome://extensions, press Reload on pi-webview, then retry. " +
      `Current pi side expects browser companion protocol ${COMPANION_PROTOCOL_VERSION}.`,
  );
}

const INLINE_DOM_BYTES = 45_000;
const TEMP_TTL_MS = 24 * 60 * 60_000;

export async function requestBrowserTool(
  operation: BrowserPageToolOperation,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
  actions?: BrowserPageAction[],
  selector?: string,
  editor?: BrowserEditorRequest,
  script?: BrowserScriptRequest,
  domMode?: BrowserDomMode,
  expectedHost?: string,
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
      ...(editor ? { editor } : {}),
      ...(script ? { script } : {}),
      ...(domMode ? { domMode } : {}),
      ...(expectedHost ? { expectedHost } : {}),
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
    if (result.outcome === "consent") {
      throw new Error(
        `${result.error || "Authorization required."}\n` +
          "This is not an execution timeout: the request never reached the page, so nothing happened. " +
          "Ask the user to answer the authorization dialog in the pi-webview side panel, then retry.",
      );
    }
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

interface CompactDomNode {
  selector: string;
  tag: string;
  role?: string;
  label?: string;
  kind?: string;
  value?: string;
  state?: string;
  visible: boolean;
  ambiguous?: boolean;
}

export function compactDomResult(result: BrowserToolResponse): ToolResult {
  requireCompanionProtocol(result, 2, "The compact DOM view");
  if (result.domMode !== "compact") {
    throw new Error(
      "The running pi-webview Chrome companion returned a full DOM payload for a compact request. " +
        "Reload the extension in chrome://extensions and retry; the empty control list was not a real page state.",
    );
  }
  const nodes = (result.nodes ?? []) as CompactDomNode[];
  const lines = nodes.map((node, index) => {
    const parts = [
      `${index + 1}. ${node.kind ?? node.tag}`,
      node.label ? `"${node.label}"` : undefined,
      node.value ? `value ${node.value}` : undefined,
      node.state ? `[${node.state}]` : undefined,
      node.visible ? undefined : "(not visible)",
      node.role ? `role=${node.role}` : undefined,
      node.ambiguous ? "AMBIGUOUS selector (matches several elements)" : undefined,
      `selector: ${node.selector}`,
    ].filter((part): part is string => Boolean(part));
    return parts.join(" ");
  });
  const omitted =
    result.nodeOmitted !== undefined && result.nodeOmitted > 0
      ? `\n${result.nodeOmitted} further nodes omitted (raise the limit or read a selector instead).`
      : "";
  return {
    content: [
      {
        type: "text",
        text:
          `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}\n` +
          `Visible controls: ${result.nodeTotal ?? nodes.length} (compact view: no script, style or template content, values redacted)\n\n` +
          `${lines.join("\n")}${omitted}`,
      },
    ],
    details: {
      operation: "dom",
      domMode: "compact",
      url: result.url,
      title: result.title,
      nodes,
      nodeTotal: result.nodeTotal,
    },
  };
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
  requireCompanionProtocol(
    result,
    2,
    "Click default-action control and action reporting",
  );
  const actionResults = result.actionResults ?? [];
  const completed = actionResults.filter((item) => item.ok).length;
  const failures = actionResults
    .filter((item) => !item.ok)
    .map((item) => `Action ${item.index + 1} (${item.type}): ${item.error || "failed"}`);
  const clicks = actionResults
    .filter((item) => item.ok && item.outcome !== undefined)
    .map((item) => {
      const parts = [
        `Click ${item.index + 1} ${item.target ?? item.selector ?? ""}`.trim(),
        item.outcome === "suppressed"
          ? "browser default suppressed on request (no submit, hash change or navigation)"
          : item.outcome === "canceled"
            ? "the page canceled the default action"
            : "default action left to the browser",
        item.hash !== undefined ? `hash now ${item.hash || "(empty)"}` : undefined,
      ];
      return `- ${parts.filter((line): line is string => Boolean(line)).join("; ")}`;
    });
  const metadata = [
    `Browser page: ${result.title || "Untitled"}`,
    `URL: ${result.url || "unknown"}`,
    result.urlBefore || result.urlAfter
      ? `URL before: ${result.urlBefore ?? "unknown"} → after: ${result.urlAfter ?? "unknown"}`
      : undefined,
    result.actionId ? `Action id: ${result.actionId}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return {
    content: [
      {
        type: "text",
        text:
          `${metadata}\nDispatched ${completed} of ${actionResults.length} actions. ` +
          "This confirms event delivery only: the application outcome is not implied and must be checked with browser_page_dom, browser_page_screenshot or by reading the page state again." +
          (clicks.length > 0 ? `\n${clicks.join("\n")}` : "") +
          (failures.length > 0 ? `\n${failures.join("\n")}` : ""),
      },
    ],
    details: {
      operation: "action",
      url: result.url,
      title: result.title,
      actionId: result.actionId,
      urlBefore: result.urlBefore,
      urlAfter: result.urlAfter,
      actionResults,
    },
  };
}

const INLINE_EDITOR_CONTENT_BYTES = 45_000;

export function editorToolResult(result: BrowserToolResponse): ToolResult {
  requireCompanionProtocol(result, 2, "The browser editor tool");
  const metadata = `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}`;
  if (result.editors) {
    const ids = result.editors.map((editor) => editor.editorId);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      throw new Error(
        `The running pi-webview Chrome companion reported duplicate editor ids (${[...new Set(duplicates)].join(", ")}), ` +
          "so read and write could not resolve one target. Reload the extension in chrome://extensions and retry.",
      );
    }
    const lines = result.editors.map((editor) => {
      const parts = [
        `${editor.editorId} (${editor.kind}${editor.verificationLevel === "dom-only" ? ", DOM-verified only" : ", model-verified"})`,
        editor.modelUri ? `model ${editor.modelUri}` : undefined,
        editor.language ? `${editor.language}` : undefined,
        `${editor.length} chars`,
        `${editor.lines} lines`,
        `hash ${editor.hash}`,
        editor.readOnly ? "read-only" : "editable",
        editor.visible ? "visible" : "not visible",
        editor.label ? `label ${editor.label}` : undefined,
        editor.frameUrl ? `frame ${editor.frameUrl}` : undefined,
      ].filter(Boolean);
      return `- ${parts.join(", ")}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `${metadata}\nEditors: ${result.editors.length}\n${lines.join("\n")}\n\nRead a document with action read and its editorId; writes require the hash above.`,
        },
      ],
      details: {
        operation: "editor",
        url: result.url,
        title: result.title,
        editors: result.editors,
      },
    };
  }
  const header = [
    metadata,
    `Editor: ${result.editorId ?? "selected"} (${result.editorKind ?? "unknown"}, ` +
      `${result.editVerificationLevel === "dom-only" ? "DOM-verified only" : "model-verified"})`,
  ];
  if (result.editWarning) header.push(`Warning: ${result.editWarning}`);
  if (typeof result.changed === "boolean") {
    header.push(
      result.verified === true
        ? `Write verified by re-reading the editor document (${result.changed ? "content changed" : "content unchanged"}).`
        : "Write NOT verified: the re-read document differs from the expected content.",
    );
  }
  if (typeof result.contentHash === "string") {
    header.push(`Current hash: ${result.contentHash}`);
  }
  if (typeof result.content === "string") {
    const bytes = Buffer.byteLength(result.content);
    const head = `${header.join("\n")}\n\n`;
    if (bytes <= INLINE_EDITOR_CONTENT_BYTES) {
      return {
        content: [{ type: "text", text: `${head}${result.content}` }],
        details: {
          operation: "editor",
          url: result.url,
          title: result.title,
          editorId: result.editorId,
          contentHash: result.contentHash,
          bytes,
        },
      };
    }
    const directory = browserTempDir();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    cleanupBrowserTemp(directory);
    const path = join(directory, `editor-${randomUUID()}.txt`);
    writeFileSync(path, result.content, { encoding: "utf8", mode: 0o600 });
    const excerpt = Buffer.from(result.content)
      .subarray(0, INLINE_EDITOR_CONTENT_BYTES)
      .toString("utf8");
    return {
      content: [
        {
          type: "text",
          text: `${head}Document size: ${bytes} bytes. The complete editor document was saved to ${path}.\n\n${excerpt}\n\n[Inline excerpt truncated; use read with offsets on the file above.]`,
        },
      ],
      details: {
        operation: "editor",
        url: result.url,
        title: result.title,
        editorId: result.editorId,
        contentHash: result.contentHash,
        bytes,
        path,
      },
    };
  }
  return {
    content: [{ type: "text", text: header.join("\n") }],
    details: {
      operation: "editor",
      url: result.url,
      title: result.title,
      editorId: result.editorId,
      contentHash: result.contentHash,
      changed: result.changed,
      verified: result.verified,
    },
  };
}

export function scriptToolResult(result: BrowserToolResponse): ToolResult {
  requireCompanionProtocol(result, 2, "The browser script tool");
  const metadata = `Browser page: ${result.title || "Untitled"}\nURL: ${result.url || "unknown"}`;
  const header = [
    metadata,
    `Result type: ${result.scriptType ?? "unknown"}`,
    typeof result.scriptDurationMs === "number"
      ? `Duration: ${result.scriptDurationMs} ms${result.scriptTruncated ? " (output truncated)" : ""}`
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return {
    content: [
      {
        type: "text",
        text: `${header}\n\n${result.scriptValue ?? "No value was returned."}`,
      },
    ],
    details: {
      operation: "script",
      url: result.url,
      title: result.title,
      scriptType: result.scriptType,
      scriptTruncated: result.scriptTruncated,
      scriptDurationMs: result.scriptDurationMs,
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
  const expectedHost = Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 253,
      description:
        "Bare host of the page this call may operate on (e.g. one.example.com). When the active page is another host the call fails explicitly instead of acting on the wrong tab.",
    }),
  );
  pi.registerTool({
    name: "browser_page_dom",
    label: "Browser Page DOM",
    description:
      "Read the complete serialized DOM of the web page associated with the pi-webview browser side panel.",
    promptSnippet: "Read the active browser page DOM",
    promptGuidelines: [
      "Use browser_page_dom when the user's request depends on page structure or content that is not present in the visible browser context.",
      "The default compact view lists visible controls with labels, values and unique selectors, and excludes script/style/template content; it is usually enough to pick a selector.",
      "Ask for mode full only when the compact view is insufficient (unusual structure, debugging), because complete pages are large and may contain unnecessary metadata.",
    ],
    parameters: Type.Object(
      {
        mode: Type.Optional(
          Type.Union([Type.Literal("compact"), Type.Literal("full")], {
            description:
              "compact (default) lists visible controls; full serializes the HTML",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const domMode: BrowserDomMode = params.mode === "full" ? "full" : "compact";
      const result = await requestBrowserTool(
        "dom",
        signal,
        process.env,
        fetch,
        undefined,
        undefined,
        undefined,
        undefined,
        domMode,
      );
      return domMode === "full" ? domToolResult(result) : compactDomResult(result);
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
          undefined,
          undefined,
          "full",
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

  const editorEdit = Type.Object(
    {
      fromLine: Type.Integer({ minimum: 1, maximum: 5_000_000 }),
      fromColumn: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      toLine: Type.Integer({ minimum: 1, maximum: 5_000_000 }),
      toColumn: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      text: Type.String({ maxLength: 400_000 }),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "browser_page_editor",
    label: "Browser Page Editor Document",
    description:
      "Read and modify the real document of a web code editor through the editor API itself, with a content-hash guard before writing and a verified re-read afterwards. Editors are recognised by API shape (value API, offset document, model registry), never by library name; fields that only expose the standard editing pipeline are reported as DOM-verified only.",
    promptSnippet: "Read or edit a web code editor document",
    promptGuidelines: [
      "Use browser_page_editor instead of browser_page_action type when the target is a code editor or code textarea: synthetic DOM events can update the visible textarea without changing the document the editor actually saves.",
      "Start with action list to obtain the editorId, length and content hash, then action read before planning a change.",
      "Ids are unique per frame; when a page has hidden helper fields, add filters {visibleOnly: true} or {editableOnly: true} to pick the real editor.",
      "Writes require the hash obtained from the current read: if the document changed, the write is rejected and you must read again.",
      "Use action apply with line/column ranges (1-based) for targeted changes and action replace only for a full document.",
      "A successful write is verified by re-reading the editor document; this tool never saves, submits or publishes. Ask for or use the application's own Save action and reopen the document to confirm persistence.",
      "If no editor is detected, do not claim success: report that the page exposes no editor API and ask the user for help.",
      "Respect the reported verification level: model-verified means the editor document was re-read; dom-only means the change reached the DOM field and the application may not have adopted it.",
    ],
    parameters: Type.Object(
      {
        action: Type.Union([
          Type.Literal("list"),
          Type.Literal("read"),
          Type.Literal("replace"),
          Type.Literal("apply"),
        ]),
        editorId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        expectedHash: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 64,
            description: "Content hash from the current read, required for writes",
          }),
        ),
        text: Type.Optional(
          Type.String({
            maxLength: 400_000,
            description: "Complete document for action replace",
          }),
        ),
        edits: Type.Optional(Type.Array(editorEdit, { minItems: 1, maxItems: 50 })),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const editor = normalizeBrowserEditorRequest({
        action: params.action,
        editorId: params.editorId,
        expectedHash: params.expectedHash,
        text: params.text,
        edits: params.edits,
      });
      return editorToolResult(
        await requestBrowserTool(
          "editor",
          signal,
          process.env,
          fetch,
          undefined,
          undefined,
          editor,
        ),
      );
    },
  });

  pi.registerTool({
    name: "browser_page_script",
    label: "Browser Page Script",
    description:
      "Execute JavaScript in the real page context and return its JSON-serializable result. Requires its own explicit script authorization (session, site or global) and is never implied by the DOM or action grants.",
    promptSnippet: "Run JavaScript in the active browser page",
    promptGuidelines: [
      "Prefer a structured tool: browser_page_dom, browser_page_element_dom, browser_page_editor, browser_page_action or browser_page_click cover most requests and carry narrower permissions.",
      "Use browser_page_script only for a check or computation that no structured tool can express, such as reading a page-exposed state object or measuring a framework's internal value.",
      "The code runs as an async function body in the page main world and must return a serializable value; resolve with return, not with DOM mutations alone.",
      "Never use it to bypass logins, OAuth, MFA, CAPTCHA or other access controls, and never return cookies, tokens, passwords or personal data.",
      "It cannot save or submit on the user's behalf: keep document changes and application Save separate and verify persistence with the normal tools.",
      "Execution requires the separate script authorization and is bounded by a timeout and an output limit; results are snapshots, not live objects.",
    ],
    parameters: Type.Object(
      {
        code: Type.String({
          minLength: 1,
          maxLength: 20_000,
          description: "Async function body executed in the page main world",
        }),
        timeoutMs: Type.Optional(
          Type.Integer({ minimum: 100, maximum: 10_000, description: "Default 5000" }),
        ),
        expectedHost,
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const script = normalizeBrowserScriptRequest({
        code: params.code,
        timeoutMs: params.timeoutMs,
      });
      return scriptToolResult(
        await requestBrowserTool(
          "script",
          signal,
          process.env,
          fetch,
          undefined,
          undefined,
          undefined,
          script,
          undefined,
          normalizeBrowserExpectedHost(params.expectedHost),
        ),
      );
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
  const clickDefaultAction = Type.Union(
    [Type.Literal("native"), Type.Literal("suppress")],
    {
      description:
        "native (default) lets the browser run the element's default action; suppress cancels it, so no submit, hash change or navigation happens even when the page does not call preventDefault",
    },
  );
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
      "Set defaultAction to suppress for SPA controls whose page handler manages the route itself, especially anchors with href='#': it keeps the page handlers running but stops the browser default, so the view does not reset.",
    ],
    parameters: Type.Object(
      {
        selector: Type.Optional(selector),
        target: Type.Optional(clickTarget),
        x: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
        y: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
        defaultAction: Type.Optional(clickDefaultAction),
        expectedHost,
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
              ...(params.defaultAction ? { defaultAction: params.defaultAction } : {}),
            }
          : {
              type: "click_at",
              x: params.x,
              y: params.y,
              ...(params.defaultAction ? { defaultAction: params.defaultAction } : {}),
            },
      ]);
      return actionToolResult(
        await requestBrowserTool(
          "action",
          signal,
          process.env,
          fetch,
          actions,
          undefined,
          undefined,
          undefined,
          undefined,
          normalizeBrowserExpectedHost(params.expectedHost),
        ),
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
        defaultAction: Type.Optional(clickDefaultAction),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("click_at"),
        x: Type.Number({ minimum: 0, maximum: 100_000 }),
        y: Type.Number({ minimum: 0, maximum: 100_000 }),
        defaultAction: Type.Optional(clickDefaultAction),
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

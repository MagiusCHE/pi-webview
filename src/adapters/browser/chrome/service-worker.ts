import type { BrowserPageContext } from "../../../ide/protocol.ts";
import {
  COMPANION_PROTOCOL_VERSION,
  isolatedBrowserNavigationAction,
  normalizeBrowserEditorRequest,
  normalizeBrowserPageActions,
  normalizeBrowserScriptRequest,
  type BrowserEditorRequest,
  type BrowserPageAction,
  type BrowserPageActionResult,
  type BrowserPageToolOperation,
} from "../../../ide/browser-tools.ts";
import { executePageActions } from "./page-actions.ts";
import { serializePageDomCompact } from "./page-dom.ts";
import type { PageDomCompactRequest, PageDomCompactResult } from "./page-dom.ts";
import { pageEditorOperation } from "./page-editor.ts";
import type { PageEditorRequestInput } from "./page-editor.ts";
import { pageScriptExecute } from "./page-script.ts";
import type { PageScriptRequestInput, PageScriptResult } from "./page-script.ts";
import { safeBrowserPageUrl } from "../context.ts";
import {
  BROWSER_PANEL_PORT,
  browserConfiguredServerUrl,
  browserSessionIntentFromServerUrl,
  persistBrowserWindowSessionIntent,
  removeBrowserWindowSessionIntent,
} from "../runtime.ts";

interface ChromePort {
  name: string;
  sender?: { tab?: ChromeTab };
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

interface ChromeTab {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

interface ChromeMessageSender {
  tab?: ChromeTab;
  url?: string;
}

interface ChromeStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeApi {
  runtime: {
    getURL(path: string): string;
    onConnect: { addListener(listener: (port: ChromePort) => void): void };
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<ChromeTab>;
    query(query: {
      active?: boolean;
      currentWindow?: boolean;
      windowId?: number;
    }): Promise<ChromeTab[]>;
    create(createProperties: { active?: boolean; windowId?: number }): Promise<ChromeTab>;
    remove(tabId: number): Promise<void>;
    reload(tabId: number): Promise<void>;
    update(tabId: number, updateProperties: { url: string }): Promise<ChromeTab>;
    captureVisibleTab(
      windowId: number | undefined,
      options: { format: "png" },
    ): Promise<string>;
    onActivated: {
      addListener(
        listener: (activeInfo: { tabId: number; windowId: number }) => void,
      ): void;
    };
    onUpdated: {
      addListener(
        listener: (
          tabId: number,
          changeInfo: Record<string, unknown>,
          tab: ChromeTab,
        ) => void,
      ): void;
    };
    onRemoved: {
      addListener(
        listener: (tabId: number, removeInfo: { windowId: number }) => void,
      ): void;
    };
  };
  windows: {
    create(options: {
      url: string;
      type: "popup";
      width: number;
      height: number;
    }): Promise<{ id?: number }>;
    onFocusChanged: { addListener(listener: (windowId: number) => void): void };
    onRemoved: { addListener(listener: (windowId: number) => void): void };
  };
  scripting: {
    executeScript<T>(
      options:
        | { target: { tabId: number }; func: () => T }
        | {
            target: { tabId: number };
            world?: "ISOLATED" | "MAIN";
            func: (actions: BrowserPageAction[]) => T | Promise<T>;
            args: [BrowserPageAction[]];
          }
        | {
            target: { tabId: number };
            func: (selector: string | null) => T;
            args: [string | null];
          }
        | {
            target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
            world?: "ISOLATED" | "MAIN";
            func: (request: PageEditorRequestInput) => T;
            args: [PageEditorRequestInput];
          }
        | {
            target: { tabId: number };
            world?: "ISOLATED" | "MAIN";
            func: (request: PageScriptRequestInput) => T | Promise<T>;
            args: [PageScriptRequestInput];
          }
        | {
            target: { tabId: number };
            world?: "ISOLATED" | "MAIN";
            func: (request: PageDomCompactRequest) => T;
            args: [PageDomCompactRequest];
          }
        | { target: { tabId: number }; files: string[] },
    ): Promise<Array<{ result?: T; frameId?: number }>>;
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    open(options: { tabId?: number; windowId?: number }): Promise<void>;
  };
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
}

declare const chrome: ChromeApi;

interface SelectionMessage {
  type: "page_selection";
  ranges?: Array<{ text?: unknown }>;
  documentId?: unknown;
}

interface HandoffMessage {
  type: "standalone_handoff";
  pageUrl?: unknown;
  ticket?: unknown;
}

interface MicrophonePermissionResultMessage {
  type: "microphone_permission_result";
  ownerWindowId?: unknown;
  granted?: unknown;
}

const ports = new Map<ChromePort, number | undefined>();
const selections = new Map<
  number,
  { ranges: Array<{ text: string }>; documentId?: string }
>();
const activeTabsByWindow = new Map<number, number>();
const injectedTabs = new Set<number>();
const microphonePermissionWindows = new Map<number, number | undefined>();

function isWebPage(url: string | undefined): boolean {
  return Boolean(url && /^(?:https?):/i.test(url));
}

async function isPiwPage(pageUrl: string): Promise<boolean> {
  try {
    const page = new URL(pageUrl);
    const config = new URL("/bridge-config.json", page);
    const token = page.searchParams.get("token");
    if (token) config.searchParams.set("token", token);
    const response = await fetch(config, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { product?: unknown };
    return data.product === "pi-webview";
  } catch {
    return false;
  }
}

async function executeBrowserTool(
  port: ChromePort,
  request: {
    requestId: string;
    operation: BrowserPageToolOperation;
    actions?: unknown;
    selector?: string;
    editor?: unknown;
    script?: unknown;
    domMode?: unknown;
    expectedOrigin?: string;
    expectedUrl?: string;
    expectedDocumentId?: string;
  },
): Promise<void> {
  try {
    const windowId = ports.get(port);
    const [tab] = await chrome.tabs.query({
      active: true,
      ...(windowId === undefined ? { currentWindow: true } : { windowId }),
    });
    const tabUrl = tab?.url;
    if (tab?.id === undefined || !tabUrl) {
      throw new Error("The active browser page cannot be accessed.");
    }
    const actions =
      request.operation === "action"
        ? normalizeBrowserPageActions(request.actions)
        : undefined;
    const navigation = actions ? isolatedBrowserNavigationAction(actions) : undefined;
    // Chrome-internal pages cannot be scripted or captured, but Tabs API
    // navigation to a validated HTTP(S) destination is safe and needs no page script.
    if (!isWebPage(tabUrl) && navigation?.type !== "navigate") {
      throw new Error("The active browser page cannot be accessed.");
    }
    const tabOrigin = new URL(tabUrl).origin;
    const documentId = selections.get(tab.id)?.documentId;
    if (request.expectedOrigin && request.expectedOrigin !== tabOrigin) {
      throw new Error("The active page changed before the browser tool started.");
    }
    if (request.expectedUrl && request.expectedUrl !== safeBrowserPageUrl(tabUrl)) {
      throw new Error("The active page changed before the browser tool started.");
    }
    if (request.expectedDocumentId && request.expectedDocumentId !== documentId) {
      throw new Error("The active document changed before the browser tool started.");
    }
    const base = {
      requestId: request.requestId,
      operation: request.operation,
      companionProtocol: COMPANION_PROTOCOL_VERSION,
      url: safeBrowserPageUrl(tabUrl),
      title: tab.title,
      documentId,
    };
    if (request.operation === "dom" && request.domMode !== "full") {
      const [execution] = await chrome.scripting.executeScript<PageDomCompactResult>({
        target: { tabId: tab.id },
        world: "MAIN",
        func: serializePageDomCompact,
        args: [{ visibleOnly: true }],
      });
      const result = execution?.result;
      if (!result || !result.ok) {
        throw new Error(result?.error ?? "The page did not return a compact DOM view.");
      }
      port.postMessage({
        type: "browser_tool_result",
        result: {
          ...base,
          ok: true,
          domMode: "compact",
          nodes: result.nodes ?? [],
          nodeTotal: result.total ?? 0,
          ...(result.omitted ? { nodeOmitted: result.omitted } : {}),
        },
      });
      return;
    }
    if (request.operation === "dom") {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector: string | null) => {
          const element = selector
            ? document.querySelector(selector)
            : document.documentElement;
          if (!element) throw new Error(`No element matches ${selector}`);
          return {
            html: element.outerHTML,
            url: location.href,
            title: document.title,
            selector,
          };
        },
        // Chrome requires JSON-serializable arguments, including for full-page DOM.
        args: [request.selector ?? null],
      });
      const result = execution?.result;
      if (!result || typeof result.html !== "string") {
        throw new Error("The page did not return a serialized DOM.");
      }
      if (new URL(result.url).origin !== tabOrigin) {
        throw new Error("The active document changed while its DOM was captured.");
      }
      if (new TextEncoder().encode(result.html).length > 8 * 1024 * 1024) {
        throw new Error("The serialized DOM exceeds the 8 MiB safety limit.");
      }
      port.postMessage({
        type: "browser_tool_result",
        result: {
          ...base,
          ok: true,
          domMode: "full",
          html: result.html,
          url: safeBrowserPageUrl(result.url),
          title: result.title,
          ...(result.selector ? { selector: result.selector } : {}),
        },
      });
      return;
    }
    if (request.operation === "action") {
      if (!actions) throw new Error("The browser action request is invalid.");
      if (navigation) {
        let updated = tab;
        if (navigation.type === "reload") await chrome.tabs.reload(tab.id);
        else updated = await chrome.tabs.update(tab.id, { url: navigation.url });
        port.postMessage({
          type: "browser_tool_result",
          result: {
            ...base,
            ...(navigation.type === "navigate"
              ? {
                  url: safeBrowserPageUrl(updated.url ?? navigation.url),
                  title: updated.title ?? base.title,
                }
              : {}),
            ok: true,
            actionId: crypto.randomUUID(),
            urlBefore: base.url,
            ...(updated.url ? { urlAfter: safeBrowserPageUrl(updated.url) } : {}),
            actionResults: [{ index: 0, type: navigation.type, ok: true }],
          },
        });
        return;
      }
      const actionId = crypto.randomUUID();
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: executePageActions,
        args: [actions],
      });
      if (!Array.isArray(execution?.result)) {
        throw new Error("The page did not return action results.");
      }
      // the dispatch outcome is not the application outcome: report both URLs so
      // the agent can compare them instead of trusting "completed"
      const after = await chrome.tabs.get(tab.id).catch(() => undefined);
      port.postMessage({
        type: "browser_tool_result",
        result: {
          ...base,
          ok: true,
          actionId,
          urlBefore: base.url,
          ...(after?.url ? { urlAfter: safeBrowserPageUrl(after.url) } : {}),
          actionResults: execution.result,
        },
      });
      return;
    }
    if (request.operation === "editor") {
      const editorRequest = normalizeBrowserEditorRequest(request.editor);
      if (editorRequest.action === "list") {
        const executions = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          world: "MAIN",
          func: pageEditorOperation,
          args: [{ action: "list" }],
        });
        const editors: Array<Record<string, unknown>> = [];
        const failures: string[] = [];
        for (const execution of executions) {
          const result = execution.result;
          if (!result) continue;
          const frameId = execution.frameId ?? 0;
          if (!result.ok) {
            if (result.error) failures.push(result.error);
            continue;
          }
          for (const editor of result.editors ?? []) {
            editors.push({
              ...editor,
              editorId: `f${frameId}:${editor.editorId}`,
              ...(result.url ? { frameUrl: result.url } : {}),
            });
          }
        }
        if (editors.length === 0) {
          const frames = executions.length;
          const answered = executions.filter((execution) => execution.result).length;
          throw new Error(
            failures[0] ??
              (answered === 0
                ? `The editor scan returned no result from ${frames} frame(s): the page may have blocked the injected script. Reload the page and retry.`
                : `No supported JavaScript editor was found in this page (${answered} of ${frames} frame(s) reported a scan result).`),
          );
        }
        port.postMessage({
          type: "browser_tool_result",
          result: { ...base, ok: true, editors },
        });
        return;
      }
      const frameId = Number(
        editorRequest.editorId.slice(1, editorRequest.editorId.indexOf(":")),
      );
      if (!Number.isInteger(frameId) || frameId < 0) {
        throw new Error("The editor identifier is invalid.");
      }
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        world: "MAIN",
        func: pageEditorOperation,
        args: [
          {
            action: editorRequest.action,
            editorId: editorRequest.editorId.slice(
              editorRequest.editorId.indexOf(":") + 1,
            ),
            ...(editorRequest.action === "replace" ? { text: editorRequest.text } : {}),
            ...(editorRequest.action === "replace" || editorRequest.action === "apply"
              ? { expectedHash: editorRequest.expectedHash }
              : {}),
            ...(editorRequest.action === "apply" ? { edits: editorRequest.edits } : {}),
          },
        ],
      });
      const result = execution?.result;
      if (!result) {
        throw new Error(
          "The editor frame is no longer accessible: it may have been removed or reloaded.",
        );
      }
      port.postMessage({
        type: "browser_tool_result",
        result: {
          ...base,
          ...(result.url ? { url: safeBrowserPageUrl(result.url) } : {}),
          ok: result.ok,
          editorId: editorRequest.editorId,
          ...(result.error ? { error: result.error } : {}),
          ...(result.editorKind ? { editorKind: result.editorKind } : {}),
          ...(result.verificationLevel
            ? { editVerificationLevel: result.verificationLevel }
            : {}),
          ...(result.warning ? { editWarning: result.warning } : {}),
          ...(typeof result.content === "string" ? { content: result.content } : {}),
          ...(typeof result.contentLength === "number"
            ? { contentLength: result.contentLength }
            : {}),
          ...(typeof result.contentLines === "number"
            ? { contentLines: result.contentLines }
            : {}),
          ...(typeof result.contentHash === "string"
            ? { contentHash: result.contentHash }
            : {}),
          ...(typeof result.previousHash === "string"
            ? { previousHash: result.previousHash }
            : {}),
          ...(typeof result.changed === "boolean" ? { changed: result.changed } : {}),
          ...(typeof result.verified === "boolean" ? { verified: result.verified } : {}),
        },
      });
      return;
    }
    if (request.operation === "script") {
      const scriptRequest = normalizeBrowserScriptRequest(request.script);
      const [execution] = await chrome.scripting.executeScript<PageScriptResult>({
        target: { tabId: tab.id },
        world: "MAIN",
        func: pageScriptExecute,
        args: [scriptRequest],
      });
      const result = execution?.result;
      if (!result) {
        throw new Error("The page did not return a result for the executed script.");
      }
      port.postMessage({
        type: "browser_tool_result",
        result: {
          ...base,
          ok: result.ok,
          ...(typeof result.value === "string" ? { scriptValue: result.value } : {}),
          ...(typeof result.type === "string" ? { scriptType: result.type } : {}),
          ...(typeof result.truncated === "boolean"
            ? { scriptTruncated: result.truncated }
            : {}),
          ...(typeof result.durationMs === "number"
            ? { scriptDurationMs: result.durationMs }
            : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      });
      return;
    }
    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    const current = await chrome.tabs.get(tab.id);
    if (!current.active || current.url !== tabUrl) {
      throw new Error("The active page changed while the screenshot was captured.");
    }
    port.postMessage({
      type: "browser_tool_result",
      result: { ...base, ok: true, imageDataUrl },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.postMessage({
      type: "browser_tool_result",
      result: {
        requestId: request.requestId,
        operation: request.operation,
        ok: false,
        // the page may have acted before the failure: never imply "not executed"
        outcome: "unknown",
        error: message,
      },
    });
  }
}

async function finishHandoff(port: ChromePort): Promise<void> {
  const stored = await chrome.storage.local.get("pendingHandoff");
  const pending = stored.pendingHandoff as
    { sourceTabId?: unknown; windowId?: unknown; createdAt?: unknown } | undefined;
  const portWindowId = ports.get(port);
  if (
    typeof pending?.sourceTabId !== "number" ||
    typeof pending.createdAt !== "number" ||
    Date.now() - pending.createdAt > 30_000
  ) {
    await chrome.storage.local.remove("pendingHandoff");
    return;
  }
  if (
    typeof pending.windowId === "number" &&
    portWindowId !== undefined &&
    pending.windowId !== portWindowId
  ) {
    return;
  }
  const replacement = await chrome.tabs.create({
    active: true,
    ...(typeof pending.windowId === "number" ? { windowId: pending.windowId } : {}),
  });
  if (replacement.id !== pending.sourceTabId) {
    await chrome.tabs.remove(pending.sourceTabId);
  }
  await chrome.storage.local.remove("pendingHandoff");
}

function hasPanelPort(windowId?: number): boolean {
  for (const portWindowId of ports.values()) {
    if (windowId === undefined || portWindowId === windowId) return true;
  }
  return false;
}

function post(message: unknown, windowId?: number): void {
  for (const [port, portWindowId] of ports) {
    if (
      windowId !== undefined &&
      portWindowId !== undefined &&
      portWindowId !== windowId
    ) {
      continue;
    }
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

function microphonePermissionWindowFor(
  ownerWindowId: number | undefined,
): number | undefined {
  for (const [popupWindowId, owner] of microphonePermissionWindows) {
    if (owner === ownerWindowId) return popupWindowId;
  }
  return undefined;
}

async function openMicrophonePermissionWindow(
  ownerWindowId: number | undefined,
): Promise<void> {
  if (microphonePermissionWindowFor(ownerWindowId) !== undefined) return;
  const url = new URL(chrome.runtime.getURL("microphone-permission.html"));
  if (ownerWindowId !== undefined) {
    url.searchParams.set("ownerWindowId", String(ownerWindowId));
  }
  const popup = await chrome.windows.create({
    url: url.toString(),
    type: "popup",
    width: 460,
    height: 260,
  });
  if (popup.id === undefined) throw new Error("microphone-permission-window-unavailable");
  microphonePermissionWindows.set(popup.id, ownerWindowId);
}

async function ensureContentScript(tab: ChromeTab): Promise<void> {
  if (tab.id === undefined || !isWebPage(tab.url) || injectedTabs.has(tab.id)) return;
  injectedTabs.add(tab.id);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"],
    });
  } catch {
    injectedTabs.delete(tab.id);
  }
}

async function contextForTab(tab: ChromeTab): Promise<BrowserPageContext | null> {
  if (tab.id === undefined || !tab.url) return null;
  const selection = selections.get(tab.id);
  return {
    url: safeBrowserPageUrl(tab.url),
    title: tab.title?.trim() || new URL(tab.url).hostname || tab.url,
    ...(tab.favIconUrl ? { faviconUrl: tab.favIconUrl } : {}),
    ranges: selection?.ranges ?? [],
    ...(selection?.documentId ? { documentId: selection.documentId } : {}),
    ...(!isWebPage(tab.url) ? { restricted: true } : {}),
  };
}

async function publishTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== undefined) activeTabsByWindow.set(tab.windowId, tabId);
    await ensureContentScript(tab);
    const context = await contextForTab(tab);
    post(
      context
        ? { type: "browser_context_changed", context }
        : { type: "browser_context_cleared", reason: "no-active-page" },
      tab.windowId,
    );
  } catch {
    post({ type: "browser_context_cleared", reason: "page-unavailable" });
  }
}

async function publishActiveTab(windowId?: number): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    ...(windowId === undefined ? { currentWindow: true } : { windowId }),
  });
  if (tab?.id !== undefined) await publishTab(tab.id);
}

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== BROWSER_PANEL_PORT) return;
  ports.set(port, undefined);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((message) => {
    const data = message as {
      type?: unknown;
      requestId?: unknown;
      operation?: unknown;
      windowId?: unknown;
      expectedOrigin?: unknown;
      expectedUrl?: unknown;
      expectedDocumentId?: unknown;
      actions?: unknown;
      selector?: unknown;
      editor?: unknown;
      script?: unknown;
      domMode?: unknown;
    };
    if (data?.type === "panel_ready") {
      const windowId = typeof data.windowId === "number" ? data.windowId : undefined;
      ports.set(port, windowId);
      void publishActiveTab(windowId);
    }
    if (data?.type === "handoff_adopted" || data?.type === "handoff_ready") {
      void finishHandoff(port);
    }
    if (data?.type === "request_microphone_permission") {
      const windowId = ports.get(port);
      void openMicrophonePermissionWindow(windowId)
        .then(() => post({ type: "browser_microphone_permission_opened" }, windowId))
        .catch(() =>
          post(
            {
              type: "browser_microphone_permission",
              granted: false,
              error: "permission-window-unavailable",
            },
            windowId,
          ),
        );
    }
    if (
      data?.type === "browser_tool_execute" &&
      typeof data.requestId === "string" &&
      (data.operation === "dom" ||
        data.operation === "screenshot" ||
        data.operation === "action" ||
        data.operation === "editor" ||
        data.operation === "script")
    ) {
      void executeBrowserTool(port, {
        requestId: data.requestId,
        operation: data.operation,
        ...(data.operation === "action" ? { actions: data.actions } : {}),
        ...(data.operation === "editor" ? { editor: data.editor } : {}),
        ...(data.operation === "script" ? { script: data.script } : {}),
        ...(data.domMode === "full" ? { domMode: "full" as const } : {}),
        ...(data.operation === "dom" && typeof data.selector === "string"
          ? { selector: data.selector }
          : {}),
        ...(typeof data.expectedOrigin === "string"
          ? { expectedOrigin: data.expectedOrigin }
          : {}),
        ...(typeof data.expectedUrl === "string"
          ? { expectedUrl: data.expectedUrl }
          : {}),
        ...(typeof data.expectedDocumentId === "string"
          ? { expectedDocumentId: data.expectedDocumentId }
          : {}),
      });
    }
  });
  // The panel sends its owning window id as soon as its runtime is ready.
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const data = message as
    SelectionMessage | HandoffMessage | MicrophonePermissionResultMessage;
  if (
    data?.type === "microphone_permission_result" &&
    sender.url?.startsWith(chrome.runtime.getURL("microphone-permission.html"))
  ) {
    const ownerWindowId =
      typeof data.ownerWindowId === "number" ? data.ownerWindowId : undefined;
    const granted = data.granted === true;
    if (granted) {
      const popupWindowId = microphonePermissionWindowFor(ownerWindowId);
      if (popupWindowId !== undefined) microphonePermissionWindows.delete(popupWindowId);
    }
    post({ type: "browser_microphone_permission", granted }, ownerWindowId);
    sendResponse({ ok: true });
    return;
  }
  if (data?.type === "page_selection" && sender.tab?.id !== undefined) {
    const ranges = (data.ranges ?? [])
      .map((range) => ({ text: typeof range.text === "string" ? range.text : "" }))
      .filter((range) => range.text.length > 0);
    selections.set(sender.tab.id, {
      ranges,
      ...(typeof data.documentId === "string" ? { documentId: data.documentId } : {}),
    });
    if (
      sender.tab.active ||
      (sender.tab.windowId !== undefined &&
        activeTabsByWindow.get(sender.tab.windowId) === sender.tab.id)
    ) {
      void publishTab(sender.tab.id);
    }
    return;
  }
  if (data?.type === "standalone_handoff" && sender.tab?.id !== undefined) {
    const pageUrl = typeof data.pageUrl === "string" ? data.pageUrl : sender.tab.url;
    const ticket = typeof data.ticket === "string" ? data.ticket : "";
    if (!pageUrl || !isWebPage(pageUrl) || !ticket) {
      sendResponse({ ok: false, error: "invalid-page-url" });
      return;
    }
    const sourceTabId = sender.tab.id;
    const windowId = sender.tab.windowId;
    const panelAlreadyOpen = hasPanelPort(windowId);
    // Invoke sidePanel.open before any await so Chrome retains the transient
    // user activation relayed by the confirmed handoff click.
    const openPanel = panelAlreadyOpen
      ? Promise.resolve()
      : chrome.sidePanel.open(
          windowId === undefined ? { tabId: sourceTabId } : { windowId },
        );
    void (async () => {
      try {
        if (!(await isPiwPage(pageUrl))) {
          sendResponse({ ok: false, error: "not-a-piw-server" });
          return;
        }
        if (windowId !== undefined) {
          await persistBrowserWindowSessionIntent(
            browserSessionIntentFromServerUrl(pageUrl),
            windowId,
            chrome.storage.session,
          );
        }
        await chrome.storage.local.set({
          serverUrl: browserConfiguredServerUrl(pageUrl),
          pendingHandoff: {
            sourceTabId,
            windowId,
            ticket,
            createdAt: Date.now(),
          },
        });
        await openPanel;
        if (panelAlreadyOpen) {
          post({ type: "browser_handoff_available" }, windowId);
        }
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false, error: "side-panel-open-failed" });
      }
    })();
    return true;
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => void publishTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    selections.delete(tabId);
    injectedTabs.delete(tabId);
  }
  const activeInWindow =
    tab.windowId !== undefined && activeTabsByWindow.get(tab.windowId) === tabId;
  if (!activeInWindow && !tab.active) return;
  if (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl) return;
  void publishTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
  selections.delete(tabId);
  injectedTabs.delete(tabId);
  if (activeTabsByWindow.get(windowId) === tabId) activeTabsByWindow.delete(windowId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId >= 0) void publishActiveTab(windowId);
});
chrome.windows.onRemoved.addListener((windowId) => {
  const ownerWindowId = microphonePermissionWindows.get(windowId);
  if (microphonePermissionWindows.delete(windowId)) {
    post(
      {
        type: "browser_microphone_permission",
        granted: false,
        error: "permission-window-dismissed",
      },
      ownerWindowId,
    );
  }
  void removeBrowserWindowSessionIntent(windowId, chrome.storage.session);
});

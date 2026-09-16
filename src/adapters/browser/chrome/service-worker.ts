import type { BrowserPageContext } from "../../../ide/protocol.ts";
import {
  normalizeBrowserPageActions,
  type BrowserPageAction,
  type BrowserPageActionResult,
  type BrowserToolOperation,
} from "../../../ide/browser-tools.ts";
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
}

interface ChromeStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeApi {
  runtime: {
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
            func: (selector: string | undefined) => T;
            args: [string | undefined];
          }
        | { target: { tabId: number }; files: string[] },
    ): Promise<Array<{ result?: T }>>;
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

const ports = new Map<ChromePort, number | undefined>();
const selections = new Map<
  number,
  { ranges: Array<{ text: string }>; documentId?: string }
>();
const activeTabsByWindow = new Map<number, number>();
const injectedTabs = new Set<number>();

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

async function executePageActions(
  actions: BrowserPageAction[],
): Promise<BrowserPageActionResult[]> {
  const results: BrowserPageActionResult[] = [];
  const eventOptions = { bubbles: true, composed: true };
  const settlePageFrames = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const normalizedEditableText = (value: string) =>
    value.replace(/[\u200b\u2060]/g, "").replace(/\u00a0/g, " ");
  const dispatchPointerClick = (target: Element, clientX: number, clientY: number) => {
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    const pointer = {
      ...eventOptions,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX,
      clientY,
      button: 0,
    };
    const mouse = { ...eventOptions, clientX, clientY, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerover", pointer));
    target.dispatchEvent(new MouseEvent("mouseover", mouse));
    target.dispatchEvent(new PointerEvent("pointerenter", pointer));
    target.dispatchEvent(new MouseEvent("mouseenter", mouse));
    target.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    target.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...mouse, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("click", { ...mouse, buttons: 0 }));
  };

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    try {
      if (action.type === "reload" || action.type === "navigate") {
        throw new Error("Navigation actions must be handled by the browser host.");
      }
      const selector = "selector" in action ? action.selector : undefined;
      const element = selector ? document.querySelector(selector) : undefined;
      if (selector && !(element instanceof HTMLElement)) {
        throw new Error(`No HTML element matches ${selector}`);
      }
      if (action.type === "click") {
        const selected = element as HTMLElement;
        selected.scrollIntoView({ block: "center", inline: "center" });
        await settlePageFrames();
        const rect = selected.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          throw new Error("The target element is not visible.");
        }
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(clientX, clientY);
        const target =
          hit instanceof Element && (action.target === "visual" || selected.contains(hit))
            ? hit
            : selected;
        dispatchPointerClick(target, clientX, clientY);
      } else if (action.type === "click_at") {
        if (action.x >= window.innerWidth || action.y >= window.innerHeight) {
          throw new Error("The click coordinates are outside the current viewport.");
        }
        const target = document.elementFromPoint(action.x, action.y);
        if (!(target instanceof Element)) {
          throw new Error("No page element exists at the requested coordinates.");
        }
        dispatchPointerClick(target, action.x, action.y);
      } else if (action.type === "focus") {
        (element as HTMLElement).focus();
      } else if (action.type === "type") {
        const target = element as HTMLElement;
        const clear = action.clear !== false;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const current = clear ? "" : target.value;
          const prototype =
            target instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) throw new Error("The field value cannot be changed.");
          target.focus();
          setter.call(target, current + action.text);
          target.dispatchEvent(
            new InputEvent("input", { ...eventOptions, data: action.text }),
          );
          target.dispatchEvent(new Event("change", eventOptions));
        } else if (target.isContentEditable) {
          const editable = target.closest<HTMLElement>('[contenteditable="true"]');
          if (!editable) throw new Error("The editable root cannot be found.");
          const beforeText = normalizedEditableText(editable.textContent ?? "");
          const range = document.createRange();
          range.selectNodeContents(clear ? editable : target);
          if (!clear) range.collapse(false);
          editable.focus({ preventScroll: true });
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange", eventOptions));

          const beforeInput = new InputEvent("beforeinput", {
            ...eventOptions,
            cancelable: true,
            data: action.text,
            inputType: "insertText",
          });
          if (typeof StaticRange === "function") {
            const targetRange = new StaticRange({
              startContainer: range.startContainer,
              startOffset: range.startOffset,
              endContainer: range.endContainer,
              endOffset: range.endOffset,
            });
            Object.defineProperty(beforeInput, "getTargetRanges", {
              value: () => [targetRange],
            });
          }
          editable.dispatchEvent(beforeInput);

          if (!beforeInput.defaultPrevented) {
            const inserted = document.execCommand("insertText", false, action.text);
            if (!inserted) {
              range.deleteContents();
              const text = document.createTextNode(action.text);
              range.insertNode(text);
              range.setStartAfter(text);
              range.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(range);
              editable.dispatchEvent(
                new InputEvent("input", {
                  ...eventOptions,
                  data: action.text,
                  inputType: "insertText",
                }),
              );
            }
          }

          await settlePageFrames();
          const afterText = normalizedEditableText(editable.textContent ?? "");
          const expectedText = normalizedEditableText(action.text);
          const changed = afterText !== beforeText;
          const retained = clear
            ? expectedText.length === 0
              ? afterText.trim().length === 0
              : afterText.includes(expectedText)
            : expectedText.length === 0 ||
              (changed && afterText.length >= beforeText.length + expectedText.length);
          if (!retained) {
            throw new Error("The contenteditable editor rejected the text insertion.");
          }
        } else {
          throw new Error("The target is not an editable field.");
        }
      } else if (action.type === "select") {
        if (!(element instanceof HTMLSelectElement)) {
          throw new Error("The target is not a select element.");
        }
        if (![...element.options].some((option) => option.value === action.value)) {
          throw new Error(`The select has no option with value ${action.value}`);
        }
        element.focus();
        element.value = action.value;
        element.dispatchEvent(new Event("input", eventOptions));
        element.dispatchEvent(new Event("change", eventOptions));
      } else if (action.type === "class") {
        const target = element as HTMLElement;
        if (action.remove?.length) target.classList.remove(...action.remove);
        if (action.add?.length) target.classList.add(...action.add);
      } else if (action.type === "style") {
        const target = element as HTMLElement;
        for (const property of action.remove ?? []) {
          target.style.removeProperty(property);
        }
        for (const value of action.set ?? []) {
          target.style.setProperty(value.property, value.value, value.priority ?? "");
        }
      } else {
        const deltaX = action.deltaX;
        const deltaY = action.deltaY;
        if (element && deltaX === undefined && deltaY === undefined) {
          element.scrollIntoView({
            behavior: "auto",
            block: action.block ?? "center",
            inline: action.inline ?? "nearest",
          });
        } else if (element) {
          element.scrollBy({
            left: deltaX ?? 0,
            top: deltaY ?? 0,
            behavior: "auto",
          });
        } else {
          window.scrollBy({
            left: deltaX ?? 0,
            top: deltaY ?? 0,
            behavior: "auto",
          });
        }
      }
      results.push({
        index,
        type: action.type,
        ...(selector ? { selector } : {}),
        ...(action.type === "click_at" ? { x: action.x, y: action.y } : {}),
        ok: true,
      });
    } catch (error) {
      const selector = "selector" in action ? action.selector : undefined;
      results.push({
        index,
        type: action.type,
        ...(selector ? { selector } : {}),
        ...(action.type === "click_at" ? { x: action.x, y: action.y } : {}),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  return results;
}

async function executeBrowserTool(
  port: ChromePort,
  request: {
    requestId: string;
    operation: BrowserToolOperation;
    actions?: unknown;
    selector?: string;
    expectedOrigin?: string;
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
    if (tab?.id === undefined || !tabUrl || !isWebPage(tabUrl)) {
      throw new Error("The active browser page cannot be accessed.");
    }
    const tabOrigin = new URL(tabUrl).origin;
    const documentId = selections.get(tab.id)?.documentId;
    if (request.expectedOrigin && request.expectedOrigin !== tabOrigin) {
      throw new Error("The active page changed before the browser tool started.");
    }
    if (request.expectedDocumentId && request.expectedDocumentId !== documentId) {
      throw new Error("The active document changed before the browser tool started.");
    }
    const base = {
      requestId: request.requestId,
      operation: request.operation,
      url: safeBrowserPageUrl(tabUrl),
      title: tab.title,
      documentId,
    };
    if (request.operation === "dom") {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector: string | undefined) => {
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
        args: [request.selector],
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
          html: result.html,
          url: safeBrowserPageUrl(result.url),
          title: result.title,
          ...(result.selector ? { selector: result.selector } : {}),
        },
      });
      return;
    }
    if (request.operation === "action") {
      const actions = normalizeBrowserPageActions(request.actions);
      const navigation = actions.find(
        (action) => action.type === "reload" || action.type === "navigate",
      );
      if (navigation) {
        if (actions.length !== 1) {
          throw new Error("Navigation must be the only action in its sequence.");
        }
        if (navigation.type === "reload") await chrome.tabs.reload(tab.id);
        else await chrome.tabs.update(tab.id, { url: navigation.url });
        port.postMessage({
          type: "browser_tool_result",
          result: {
            ...base,
            ok: true,
            actionResults: [{ index: 0, type: navigation.type, ok: true }],
          },
        });
        return;
      }
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: executePageActions,
        args: [actions],
      });
      if (!Array.isArray(execution?.result)) {
        throw new Error("The page did not return action results.");
      }
      port.postMessage({
        type: "browser_tool_result",
        result: { ...base, ok: true, actionResults: execution.result },
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
    port.postMessage({
      type: "browser_tool_result",
      result: {
        requestId: request.requestId,
        operation: request.operation,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
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
      expectedDocumentId?: unknown;
      actions?: unknown;
      selector?: unknown;
    };
    if (data?.type === "panel_ready") {
      const windowId = typeof data.windowId === "number" ? data.windowId : undefined;
      ports.set(port, windowId);
      void publishActiveTab(windowId);
    }
    if (data?.type === "handoff_adopted" || data?.type === "handoff_ready") {
      void finishHandoff(port);
    }
    if (
      data?.type === "browser_tool_execute" &&
      typeof data.requestId === "string" &&
      (data.operation === "dom" ||
        data.operation === "screenshot" ||
        data.operation === "action")
    ) {
      void executeBrowserTool(port, {
        requestId: data.requestId,
        operation: data.operation,
        ...(data.operation === "action" ? { actions: data.actions } : {}),
        ...(data.operation === "dom" && typeof data.selector === "string"
          ? { selector: data.selector }
          : {}),
        ...(typeof data.expectedOrigin === "string"
          ? { expectedOrigin: data.expectedOrigin }
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
  const data = message as SelectionMessage | HandoffMessage;
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
  void removeBrowserWindowSessionIntent(windowId, chrome.storage.session);
});

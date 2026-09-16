interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

declare const chrome: { runtime: ChromeRuntime };

const contentScope = globalThis as typeof globalThis & {
  __piWebviewBrowserContentScriptCleanup?: () => void;
};

// A service-worker restart may inject this file again into an existing page.
// Tear down the previous listeners before installing the current generation.
try {
  contentScope.__piWebviewBrowserContentScriptCleanup?.();
} catch {
  // A cleanup function retained from the previous unpacked-extension context
  // is itself no longer callable after Chrome invalidates that context.
}
contentScope.__piWebviewBrowserContentScriptCleanup = initializeContentScript();

function initializeContentScript(): () => void {
  const DISCOVERY_REQUEST = "pi-webview-browser-discovery";
  const DISCOVERY_RESPONSE = "pi-webview-browser-available";
  const HANDOFF_REQUEST = "pi-webview-browser-handoff";
  const HANDOFF_RESPONSE = "pi-webview-browser-handoff-result";
  const documentId = crypto.randomUUID();
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;

  function sendRuntimeMessage(message: unknown): Promise<unknown> {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => undefined);
    } catch {
      // Chrome throws synchronously when an old page context survives an
      // unpacked-extension reload. The replacement context will be reinjected.
      return Promise.resolve(undefined);
    }
  }

  function selectedRanges(): Array<{ text: string }> {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];
    const ranges: Array<{ text: string }> = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const text = selection.getRangeAt(index).toString();
      if (text) ranges.push({ text });
    }
    return ranges;
  }

  function publishSelection(): void {
    void sendRuntimeMessage({
      type: "page_selection",
      documentId,
      ranges: selectedRanges(),
    });
  }

  function scheduleSelection(): void {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(publishSelection, 80);
  }

  function handleWindowMessage(event: MessageEvent): void {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    const message = event.data as {
      type?: unknown;
      nonce?: unknown;
      protocolVersion?: unknown;
      ticket?: unknown;
    };
    if (message.type === DISCOVERY_REQUEST && typeof message.nonce === "string") {
      window.postMessage(
        {
          type: DISCOVERY_RESPONSE,
          nonce: message.nonce,
          protocolVersion: 1,
          capabilities: [
            "side-panel",
            "page-context",
            "page-dom",
            "page-screenshot",
            "page-action",
          ],
        },
        "*",
      );
      return;
    }
    if (
      message.type === HANDOFF_REQUEST &&
      typeof message.nonce === "string" &&
      typeof message.ticket === "string"
    ) {
      const nonce = message.nonce;
      void sendRuntimeMessage({
        type: "standalone_handoff",
        pageUrl: location.href,
        ticket: message.ticket,
      }).then((result) => {
        window.postMessage(
          {
            type: HANDOFF_RESPONSE,
            nonce,
            result: result ?? { ok: false },
          },
          "*",
        );
      });
    }
  }

  document.addEventListener("selectionchange", scheduleSelection, { passive: true });
  window.addEventListener("pageshow", publishSelection, { passive: true });
  window.addEventListener("message", handleWindowMessage);
  publishSelection();

  return () => {
    clearTimeout(selectionTimer);
    document.removeEventListener("selectionchange", scheduleSelection);
    window.removeEventListener("pageshow", publishSelection);
    window.removeEventListener("message", handleWindowMessage);
  };
}

interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

declare const chrome: { runtime: ChromeRuntime };

const contentScope = globalThis as typeof globalThis & {
  __piWebviewBrowserContentScriptLoaded?: boolean;
};

if (!contentScope.__piWebviewBrowserContentScriptLoaded) {
  contentScope.__piWebviewBrowserContentScriptLoaded = true;
  initializeContentScript();
}

function initializeContentScript(): void {
  const DISCOVERY_REQUEST = "pi-webview-browser-discovery";
  const DISCOVERY_RESPONSE = "pi-webview-browser-available";
  const HANDOFF_REQUEST = "pi-webview-browser-handoff";
  const HANDOFF_RESPONSE = "pi-webview-browser-handoff-result";
  const documentId = crypto.randomUUID();
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;

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
    void chrome.runtime
      .sendMessage({
        type: "page_selection",
        documentId,
        ranges: selectedRanges(),
      })
      .catch(() => {});
  }

  function scheduleSelection(): void {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(publishSelection, 80);
  }

  document.addEventListener("selectionchange", scheduleSelection, { passive: true });
  window.addEventListener("pageshow", publishSelection, { passive: true });
  publishSelection();

  window.addEventListener("message", (event) => {
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
      void chrome.runtime
        .sendMessage({
          type: "standalone_handoff",
          pageUrl: location.href,
          ticket: message.ticket,
        })
        .then((result) => {
          window.postMessage({ type: HANDOFF_RESPONSE, nonce, result }, "*");
        })
        .catch(() => {
          window.postMessage(
            { type: HANDOFF_RESPONSE, nonce, result: { ok: false } },
            "*",
          );
        });
    }
  });
}

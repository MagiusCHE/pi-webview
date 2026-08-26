// Abstract transport for the UI: WebSocket (standalone/browser) or postMessage
// (VS Code webview). The UI never knows which host it is talking to (D2/D3).

import type { Frame } from "./protocol.ts";

export type TransportStatus =
  | { state: "connecting"; detail?: string }
  | { state: "open"; detail?: string }
  | { state: "closed"; detail?: string };

export interface Transport {
  send(frame: Frame): void;
  onFrame(cb: (frame: Frame) => void): void;
  onStatus(cb: (status: TransportStatus) => void): void;
  close(): void;
}

// --- WebSocket (native browser) ---------------------------------------------

export function createWsTransport(url: string): Transport {
  const ws = new WebSocket(url);
  const frameCbs: Array<(f: Frame) => void> = [];
  const statusCbs: Array<(s: TransportStatus) => void> = [];

  ws.onopen = () => statusCbs.forEach((cb) => cb({ state: "open", detail: url }));
  ws.onclose = () =>
    statusCbs.forEach((cb) => cb({ state: "closed", detail: "connessione chiusa" }));
  ws.onerror = () =>
    statusCbs.forEach((cb) => cb({ state: "closed", detail: "errore di connessione" }));
  ws.onmessage = (e) => {
    let frame: Frame;
    try {
      frame = JSON.parse(e.data as string) as Frame;
    } catch {
      return;
    }
    frameCbs.forEach((cb) => cb(frame));
  };

  return {
    send(frame) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    },
    onFrame(cb) {
      frameCbs.push(cb);
    },
    onStatus(cb) {
      statusCbs.push(cb);
    },
    close() {
      ws.close();
    },
  };
}

// --- WebView2 (Visual Studio adapter, concept 0005) ---------------------------
// window.chrome.webview: native WebView2 bridge. postMessage accepts objects
// (serialized as JSON to the host); PostWebMessageAsJson delivers the
// deserialized object in event.data (some hosts may still provide a string).

interface WebView2Host {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

export function createWebView2Transport(): Transport | null {
  const win = window as unknown as { chrome?: { webview?: WebView2Host } };
  const webview = win.chrome?.webview;
  if (!webview) return null;
  const frameCbs: Array<(f: Frame) => void> = [];

  const onMessage = (e: MessageEvent) => {
    let frame: Frame;
    try {
      frame =
        typeof e.data === "string"
          ? (JSON.parse(e.data) as Frame)
          : (e.data as Frame);
      if (!frame || typeof frame !== "object") return;
    } catch {
      return;
    }
    frameCbs.forEach((cb) => cb(frame));
  };
  webview.addEventListener("message", onMessage);

  return {
    send(frame) {
      webview.postMessage(frame);
    },
    onFrame(cb) {
      frameCbs.push(cb);
    },
    onStatus(cb) {
      cb({ state: "open", detail: "webview2 (Visual Studio)" });
    },
    close() {
      webview.removeEventListener("message", onMessage);
    },
  };
}

// --- VS Code webview (postMessage) -------------------------------------------

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export function createVsCodeTransport(): Transport | null {
  const win = window as unknown as { acquireVsCodeApi?: () => VsCodeApi };
  if (typeof win.acquireVsCodeApi !== "function") return null;
  const api = win.acquireVsCodeApi();
  const frameCbs: Array<(f: Frame) => void> = [];

  window.addEventListener("message", (e) => {
    frameCbs.forEach((cb) => cb(e.data as Frame));
  });

  return {
    send(frame) {
      api.postMessage(frame);
    },
    onFrame(cb) {
      frameCbs.push(cb);
    },
    onStatus(cb) {
      cb({ state: "open", detail: "webview (postMessage)" });
    },
    close() {
      // nothing to close: the lifecycle belongs to the extension host
    },
  };
}

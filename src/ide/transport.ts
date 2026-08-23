// Trasporto astratto per la UI: WebSocket (standalone/browser) o postMessage
// (webview VS Code). La UI non sa mai con quale host sta parlando (D2/D3).

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

// --- WebSocket (browser nativo) ---------------------------------------------

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
      // niente da chiudere: il ciclo di vita è dell'extension host
    },
  };
}

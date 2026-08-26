// WebView2 transport tests (Visual Studio adapter, concept 0005):
// window.chrome.webview is fake — postMessage collects the outgoing frames
// (objects), emit() simulates JSON frames arriving from the C# host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebView2Transport } from "../src/ide/transport.ts";
import type { Frame } from "../src/ide/protocol.ts";

interface FakeWebview {
  sent: unknown[];
  emit(data: unknown): void;
  listenerCount(): number;
}

function fakeWebview(): { webview: unknown; api: FakeWebview } {
  const listeners = new Set<(e: MessageEvent) => void>();
  const sent: unknown[] = [];
  const webview = {
    postMessage(m: unknown) {
      sent.push(m);
    },
    addEventListener(_t: string, l: (e: MessageEvent) => void) {
      listeners.add(l);
    },
    removeEventListener(_t: string, l: (e: MessageEvent) => void) {
      listeners.delete(l);
    },
  };
  return {
    webview,
    api: {
      sent,
      emit(data: string) {
        for (const l of [...listeners]) l({ data } as MessageEvent);
      },
      listenerCount: () => listeners.size,
    },
  };
}

test("createWebView2Transport: null senza window.chrome.webview", () => {
  (globalThis as { window?: unknown }).window = {};
  assert.equal(createWebView2Transport(), null);
});

test("createWebView2Transport: frame in uscita come oggetto, in arrivo come JSON o oggetto", () => {
  const { webview, api } = fakeWebview();
  (globalThis as { window?: unknown }).window = { chrome: { webview } };
  const t = createWebView2Transport();
  assert.ok(t);

  let received: Frame | null = null;
  let status: string | null = null;
  t.onFrame((f) => {
    received = f;
  });
  t.onStatus((s) => {
    status = s.state;
  });
  assert.equal(status, "open");

  const frame: Frame = { channel: "rpc", payload: { type: "abort" } };
  t.send(frame);
  assert.deepEqual(api.sent, [frame]);

  api.emit(
    JSON.stringify({ channel: "ide", payload: { id: "x", ok: true } }),
  );
  assert.deepEqual(received, { channel: "ide", payload: { id: "x", ok: true } });

  api.emit({ channel: "rpc", payload: { type: "ready" } });
  assert.deepEqual(received, { channel: "rpc", payload: { type: "ready" } });

  // non-JSON payload: ignored, no exception
  api.emit("not-json");
  assert.deepEqual(received, { channel: "rpc", payload: { type: "ready" } });
});

test("createWebView2Transport: close rimuove il listener message", () => {
  const { webview, api } = fakeWebview();
  (globalThis as { window?: unknown }).window = { chrome: { webview } };
  const t = createWebView2Transport();
  assert.ok(t);
  assert.equal(api.listenerCount(), 1);
  t.close();
  assert.equal(api.listenerCount(), 0);
});

test("createWebView2Transport: frame in arrivo dal canale rpc", () => {
  const { webview, api } = fakeWebview();
  (globalThis as { window?: unknown }).window = { chrome: { webview } };
  const t = createWebView2Transport();
  assert.ok(t);
  let received: Frame | null = null;
  t.onFrame((f) => {
    received = f;
  });
  api.emit(JSON.stringify({ channel: "rpc", payload: { type: "turn_start" } }));
  assert.deepEqual(received, { channel: "rpc", payload: { type: "turn_start" } });
});

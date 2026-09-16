import assert from "node:assert/strict";
import test from "node:test";
import {
  browserClientWebSocketUrl,
  browserConfiguredServerUrl,
  browserServerUrlWithNewSession,
  browserServerUrlWithPanelIntent,
  browserServerUrlWithSession,
  browserSessionIntentFromServerUrl,
  browserWindowSessionIntent,
  browserWindowSessionIntentKey,
  connectBrowserPanel,
  isBrowserExtensionContextInvalidated,
  persistBrowserServerNewSessionIntent,
  persistBrowserServerSession,
} from "../src/adapters/browser/runtime.ts";
import {
  BrowserConnectionError,
  DEFAULT_BROWSER_SERVER_URL,
  discoverBrowserBridge,
  parseBrowserServerUrl,
  redactBrowserServerUrl,
} from "../src/adapters/browser/connection.ts";
import {
  browserDefaultWorkspace,
  browserNewSessionWorkspace,
} from "../src/bridge/browser-workspace.ts";

test("a direct browser client starts in the OS user home", () => {
  assert.equal(
    browserClientWebSocketUrl("ws://127.0.0.1:7361/?token=private"),
    "ws://127.0.0.1:7361/?token=private&client=browser",
  );
  assert.equal(browserDefaultWorkspace("browser", "/home/test-user"), "/home/test-user");
  assert.equal(browserDefaultWorkspace(null, "/home/test-user"), undefined);
  assert.equal(
    browserNewSessionWorkspace("browser", "/home/test-user"),
    "/home/test-user",
  );
  assert.equal(browserNewSessionWorkspace(null, "/home/test-user"), undefined);
  assert.equal(
    browserNewSessionWorkspace("browser", "/home/test-user", "/launch/workspace"),
    "/launch/workspace",
  );
});

test("browser server URL defaults to loopback port 7361", () => {
  const target = parseBrowserServerUrl("");
  assert.equal(target.serverUrl, `${DEFAULT_BROWSER_SERVER_URL}/`);
  assert.equal(target.configUrl, `${DEFAULT_BROWSER_SERVER_URL}/bridge-config.json`);
});

test("browser server URL preserves credentials and separates page intent", () => {
  const target = parseBrowserServerUrl(
    "http://100.64.0.2:7361/?token=private&s=session-id#ignored",
  );
  assert.equal(
    target.configUrl,
    "http://100.64.0.2:7361/bridge-config.json?token=private",
  );
  assert.equal(target.pageIntent, "s=session-id");
  assert.equal(target.serverUrl, "http://100.64.0.2:7361/?token=private&s=session-id");
});

test("browser server URL accepts HTTPS and rejects other schemes", () => {
  assert.equal(
    parseBrowserServerUrl("https://piw.example.test/path").configUrl,
    "https://piw.example.test/bridge-config.json",
  );
  assert.throws(
    () => parseBrowserServerUrl("file:///tmp/piw"),
    (error: unknown) =>
      error instanceof BrowserConnectionError && error.code === "unsupported-scheme",
  );
});

test("browser bridge discovery validates product and applies session intent", async () => {
  const fetcher = async (input: string | URL | Request) => {
    assert.equal(String(input), "http://127.0.0.1:7361/bridge-config.json?token=private");
    return new Response(
      JSON.stringify({
        product: "pi-webview",
        protocolVersion: 1,
        wsUrl: "ws://127.0.0.1:7361/?token=bridge",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await discoverBrowserBridge(
    "http://127.0.0.1:7361/?token=private&new=1&launch=launch-id",
    fetcher,
  );
  assert.equal(
    result.wsUrl,
    "ws://127.0.0.1:7361/?token=bridge&new=1&launchId=launch-id",
  );
});

test("browser bridge discovery rejects an unmarked endpoint", async () => {
  await assert.rejects(
    discoverBrowserBridge("http://127.0.0.1:7361", async () =>
      Promise.resolve(
        new Response(JSON.stringify({ wsUrl: "ws://127.0.0.1:7361" }), {
          status: 200,
        }),
      ),
    ),
    (error: unknown) =>
      error instanceof BrowserConnectionError && error.code === "not-piw",
  );
});

test("browser connection errors distinguish unauthorized endpoint", async () => {
  await assert.rejects(
    discoverBrowserBridge("http://127.0.0.1:7361", async () =>
      Promise.resolve(new Response("unauthorized", { status: 401 })),
    ),
    (error: unknown) =>
      error instanceof BrowserConnectionError && error.code === "unauthorized",
  );
});

test("browser panel session intent overrides the stored handoff session", () => {
  assert.equal(
    browserServerUrlWithPanelIntent(
      "http://127.0.0.1:7361/?token=private&s=old",
      "?s=current",
    ),
    "http://127.0.0.1:7361/?token=private&s=current",
  );
});

test("configured endpoint stays separate from private session intent", () => {
  assert.equal(
    browserConfiguredServerUrl("http://127.0.0.1:7362?token=private"),
    "http://127.0.0.1:7362?token=private",
  );
  assert.equal(
    browserConfiguredServerUrl(
      "http://127.0.0.1:7362/?token=private&s=private-session&new=1",
    ),
    "http://127.0.0.1:7362/?token=private",
  );
  assert.equal(
    browserSessionIntentFromServerUrl(
      "http://127.0.0.1:7362/?token=private&s=private-session",
    ),
    "s=private-session",
  );
});

test("a new Chrome window starts a new session while existing windows resume", () => {
  const values = {
    [browserWindowSessionIntentKey(7)]: "s=window-seven",
    [browserWindowSessionIntentKey(8)]: "new=1",
  };
  assert.equal(browserWindowSessionIntent(values, 7), "s=window-seven");
  assert.equal(browserWindowSessionIntent(values, 8), "new=1");
  assert.equal(browserWindowSessionIntent(values, 9), "new=1");
  assert.equal(
    browserWindowSessionIntent({ sessionIntent: "s=legacy-global" }, 9),
    "new=1",
  );
  assert.equal(browserWindowSessionIntent(values, undefined), "new=1");
});

test("browser session persistence is isolated per Chrome window", async () => {
  assert.equal(
    browserServerUrlWithSession(
      "http://127.0.0.1:7362/?token=private&new=1&s=stale&launch=old",
      "adopted-session",
    ),
    "http://127.0.0.1:7362/?token=private&s=adopted-session",
  );

  const localValues: Record<string, unknown> = {
    serverUrl: "http://127.0.0.1:7362/?token=private&s=previous",
  };
  const sessionValues: Record<string, unknown> = {};
  const storageArea = (values: Record<string, unknown>) => ({
    async get() {
      return { ...values };
    },
    async set(next: Record<string, unknown>) {
      Object.assign(values, next);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  });
  let windowId = 7;
  const api = {
    storage: {
      local: storageArea(localValues),
      session: storageArea(sessionValues),
    },
    windows: { getCurrent: async () => ({ id: windowId }) },
  };
  const persisted = await persistBrowserServerSession("adopted-session", api as never);
  assert.equal(persisted, "s=adopted-session");
  assert.equal(localValues.serverUrl, "http://127.0.0.1:7362/?token=private&s=previous");
  assert.equal(sessionValues[browserWindowSessionIntentKey(7)], persisted);

  windowId = 8;
  const reset = await persistBrowserServerNewSessionIntent(api as never);
  assert.equal(reset, "new=1");
  assert.equal(localValues.serverUrl, "http://127.0.0.1:7362/?token=private&s=previous");
  assert.equal(sessionValues[browserWindowSessionIntentKey(8)], reset);
  assert.equal(sessionValues[browserWindowSessionIntentKey(7)], persisted);
  assert.equal(
    browserServerUrlWithNewSession(
      "http://127.0.0.1:7362/?token=private&s=previous&session=old",
    ),
    "http://127.0.0.1:7362/?token=private&new=1",
  );
});

test("browser panel reconnects its runtime port and flushes queued messages", async () => {
  interface FakePort {
    messages: unknown[];
    disconnected: boolean;
    messageListener?: (message: unknown) => void;
    disconnectListener?: () => void;
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: { addListener(listener: (message: unknown) => void): void };
    onDisconnect: { addListener(listener: () => void): void };
  }

  const ports: FakePort[] = [];
  const api = {
    runtime: {
      id: "test-extension",
      connect() {
        const port: FakePort = {
          messages: [],
          disconnected: false,
          postMessage(message) {
            if (this.disconnected) throw new Error("disconnected");
            this.messages.push(message);
          },
          disconnect() {
            this.disconnected = true;
            this.disconnectListener?.();
          },
          onMessage: {
            addListener(listener) {
              port.messageListener = listener;
            },
          },
          onDisconnect: {
            addListener(listener) {
              port.disconnectListener = listener;
            },
          },
        };
        ports.push(port);
        return port;
      },
    },
    windows: { getCurrent: async () => ({ id: 7 }) },
  };

  const connection = connectBrowserPanel(() => {}, api as never, 0);
  assert.ok(connection);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(ports[0]?.messages, [{ type: "panel_ready", windowId: 7 }]);

  ports[0]!.disconnect();
  connection.send({ type: "handoff_ready" });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(ports.length, 2);
  assert.deepEqual(ports[1]?.messages, [
    { type: "panel_ready", windowId: 7 },
    { type: "handoff_ready" },
  ]);
  connection.dispose();
});

test("browser panel reloads a stale page after its extension context is invalidated", () => {
  let reloads = 0;
  const api = {
    runtime: {
      id: "test-extension",
      connect() {
        throw new Error("Extension context invalidated.");
      },
    },
  };

  assert.equal(
    isBrowserExtensionContextInvalidated(new Error("Extension context invalidated.")),
    true,
  );
  const connection = connectBrowserPanel(
    () => {},
    api as never,
    0,
    () => {
      reloads += 1;
    },
  );
  assert.ok(connection);
  assert.equal(reloads, 1);
  connection.dispose();
});

test("browser server URL redaction removes query credentials", () => {
  assert.equal(
    redactBrowserServerUrl("http://100.64.0.2:7361/?token=private&s=id"),
    "http://100.64.0.2:7361/?…",
  );
});

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { BrowserToolBroker } from "../src/bridge/browser-control.ts";
import {
  BROWSER_CONTROL_CAPABILITY_ENV,
  BROWSER_CONTROL_URL_ENV,
  actionToolResult,
  domToolResult,
  registerBrowserTools,
  requestBrowserTool,
  screenshotToolResult,
} from "../packages/pi-webview/lib/browser-tools.ts";

test("browser tool broker correlates a response with its pending request", async () => {
  const broker = new BrowserToolBroker();
  let requestId = "";
  const pending = broker.request(
    "dom",
    (request) => {
      requestId = request.requestId;
    },
    undefined,
    1_000,
  );
  assert.equal(
    broker.resolve(requestId, {
      ok: true,
      operation: "dom",
      url: "https://example.test/",
      html: "<html></html>",
    }),
    true,
  );
  assert.equal((await pending).html, "<html></html>");
  assert.equal(broker.resolve(requestId, { ok: true }), false);
});

test("browser tool broker forwards a targeted DOM selector", async () => {
  const broker = new BrowserToolBroker();
  let requestId = "";
  const pending = broker.request(
    "dom",
    (request) => {
      requestId = request.requestId;
      assert.equal(request.selector, "main > form");
    },
    undefined,
    1_000,
    undefined,
    "main > form",
  );
  broker.resolve(requestId, {
    ok: true,
    operation: "dom",
    selector: "main > form",
    html: "<form></form>",
  });
  assert.equal((await pending).selector, "main > form");
});

test("browser tool broker abort and disconnect settle pending requests", async () => {
  const aborted = new BrowserToolBroker();
  const controller = new AbortController();
  const abortedRequest = aborted.request("screenshot", () => {}, controller.signal);
  controller.abort();
  assert.equal((await abortedRequest).error, "Browser tool was aborted.");

  const disconnected = new BrowserToolBroker();
  const disconnectedRequest = disconnected.request("dom", () => {});
  disconnected.dispose();
  assert.equal((await disconnectedRequest).error, "Browser session disconnected.");
});

test("browser control request is authenticated with the channel capability", async () => {
  const env = {
    [BROWSER_CONTROL_URL_ENV]: "http://127.0.0.1:7361/internal/browser-tool",
    [BROWSER_CONTROL_CAPABILITY_ENV]: "private-capability",
  };
  const result = await requestBrowserTool("dom", undefined, env, async (input, init) => {
    assert.equal(String(input), env[BROWSER_CONTROL_URL_ENV]);
    assert.equal(init?.method, "POST");
    assert.equal(
      (init?.headers as Record<string, string>)["x-pi-webview-browser-capability"],
      "private-capability",
    );
    return new Response(JSON.stringify({ ok: true, html: "<html></html>" }), {
      status: 200,
    });
  });
  assert.equal(result.html, "<html></html>");
});

test("targeted browser DOM request sends only its validated selector", async () => {
  const env = {
    [BROWSER_CONTROL_URL_ENV]: "http://127.0.0.1:7361/internal/browser-tool",
    [BROWSER_CONTROL_CAPABILITY_ENV]: "private-capability",
  };
  const result = await requestBrowserTool(
    "dom",
    undefined,
    env,
    async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        operation: "dom",
        selector: "main > form",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          operation: "dom",
          selector: "main > form",
          html: "<form></form>",
        }),
        { status: 200 },
      );
    },
    undefined,
    "main > form",
  );
  assert.equal(result.selector, "main > form");
});

test("browser action request sends only validated structured actions", async () => {
  const env = {
    [BROWSER_CONTROL_URL_ENV]: "http://127.0.0.1:7361/internal/browser-tool",
    [BROWSER_CONTROL_CAPABILITY_ENV]: "private-capability",
  };
  const actions = [{ type: "click" as const, selector: "button.publish" }];
  const result = await requestBrowserTool(
    "action",
    undefined,
    env,
    async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { operation: "action", actions });
      return new Response(
        JSON.stringify({
          ok: true,
          operation: "action",
          actionResults: [{ index: 0, type: "click", ok: true }],
        }),
        { status: 200 },
      );
    },
    actions,
  );
  assert.equal(result.actionResults?.[0]?.ok, true);
});

test("large browser DOM is retained in a private temporary file", () => {
  const html = `<html>${"x".repeat(50_000)}</html>`;
  const result = domToolResult({
    ok: true,
    operation: "dom",
    url: "https://example.test/",
    title: "Example",
    html,
  });
  const path = result.details.path;
  assert.equal(typeof path, "string");
  assert.match(result.content[0]?.text ?? "", /complete DOM was saved/);
  if (typeof path === "string") rmSync(path, { force: true });
});

test("browser screenshot becomes a typed image result", () => {
  const result = screenshotToolResult({
    ok: true,
    operation: "screenshot",
    url: "https://example.test/",
    title: "Example",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
  });
  assert.deepEqual(result.content[1], {
    type: "image",
    mimeType: "image/png",
    data: "aGVsbG8=",
  });
});

test("browser action result reports each structured action", () => {
  const result = actionToolResult({
    ok: true,
    operation: "action",
    url: "https://example.test/",
    title: "Example",
    actionResults: [
      { index: 0, type: "type", selector: "textarea", ok: true },
      { index: 1, type: "click", selector: "button", ok: false, error: "missing" },
    ],
  });
  assert.match(result.content[0]?.text ?? "", /Completed 1 of 2 actions/);
  assert.match(result.content[0]?.text ?? "", /Action 2 \(click\): missing/);
});

test("browser tools register structured page actions without JavaScript", () => {
  const definitions: Array<{ name: string; description: string }> = [];
  registerBrowserTools({
    registerTool(definition) {
      definitions.push(definition);
    },
  });
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [
      "browser_page_dom",
      "browser_page_element_dom",
      "browser_page_screenshot",
      "browser_page_class",
      "browser_page_style",
      "browser_page_click",
      "browser_page_navigation",
      "browser_page_scroll",
      "browser_page_action",
    ],
  );
  assert.match(definitions[1]!.description, /one element/i);
  assert.match(definitions[3]!.description, /CSS class/i);
  assert.match(definitions[4]!.description, /inline CSS/i);
  assert.match(definitions[5]!.description, /visual element/i);
  assert.match(definitions[6]!.description, /Reload/i);
  assert.match(definitions[7]!.description, /bring a selected element into view/i);
  const action = definitions[8]!;
  assert.match(action.description, /click, type, select, focus and scroll/);
  assert.match(action.description, /does not execute arbitrary JavaScript/i);
  assert.match(action.description, /Chrome debugger/i);
});

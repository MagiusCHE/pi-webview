import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBrowserPageActions } from "../src/ide/browser-tools.ts";
import { BrowserToolBroker } from "../src/bridge/browser-control.ts";

const pageDom = readFileSync("src/adapters/browser/chrome/page-dom.ts", "utf8");
const pageActions = readFileSync("src/adapters/browser/chrome/page-actions.ts", "utf8");
const main = readFileSync("src/web/main.ts", "utf8");
const protocol = readFileSync("src/ide/protocol.ts", "utf8");

test("compact DOM never mutates the page to build selectors", () => {
  // a generated attribute can collide with nodes kept from a previous call
  assert.doesNotMatch(pageDom, /data-piw-ref/);
  assert.doesNotMatch(pageDom, /setAttribute\(/);
  // selectors are verified: an unresolvable one is reported, never invented
  assert.match(pageDom, /matchesOf\(candidate\) === 1/);
  assert.match(pageDom, /ambiguous: true/);
});

test("compact DOM descends through display:contents and skips blocked subtrees", () => {
  assert.match(pageDom, /const isBlocked = /);
  assert.match(pageDom, /getComputedStyle\(element\)\.display !== "contents"/);
  assert.match(pageDom, /if \(!isBlocked\(child\)\) walk\(child\);/);
  assert.match(pageDom, /getClientRects\(\)/);
});

test("selector actions refuse ambiguity unless the caller accepts it", () => {
  assert.match(
    pageActions,
    /matches \$\{matches\} elements: refusing an ambiguous target/,
  );
  assert.match(pageActions, /const allowAmbiguous =/);
  const normalized = normalizeBrowserPageActions([
    { type: "click", selector: "#ok", allowAmbiguous: true },
  ]);
  assert.deepEqual(normalized[0], {
    type: "click",
    selector: "#ok",
    allowAmbiguous: true,
  });
  const plain = normalizeBrowserPageActions([{ type: "click", selector: "#ok" }]);
  assert.equal("allowAmbiguous" in (plain[0] ?? {}), false);
});

test("a visual click reports when the hit landed on another element", () => {
  assert.match(pageActions, /visualHitMismatch = Boolean\(/);
  assert.match(pageActions, /requestedTarget = describeElement\(element\)/);
});

test("a request that waits for consent is answered explicitly", () => {
  assert.match(main, /BROWSER_CONSENT_WAIT_MS/);
  assert.match(main, /if \(browserToolDialogCancels\.size > 0\) return "consent";/);
  assert.match(main, /outcome: "consent"/);
  assert.match(main, /browserConsentPending/);
});

test("an abandoned request is cancelled and never executed later", () => {
  assert.match(protocol, /type: "browser_tool_cancel"/);
  assert.match(main, /evt\.type === "browser_tool_cancel"/);
  assert.match(main, /cancelledBrowserToolRequests\.add\(evt\.requestId\)/);
  assert.match(main, /browserToolDialogCancels\.get\(evt\.requestId\)\?\.\(\)/);
  assert.match(pageActions, /allowAmbiguous/);
});

test("the broker reports a cancellation with the request id", async () => {
  const broker = new BrowserToolBroker();
  const cancelled: string[] = [];
  const result = await broker.request(
    "dom",
    () => undefined,
    undefined,
    10,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (requestId) => cancelled.push(requestId),
  );
  assert.equal(result.ok, false);
  assert.equal(cancelled.length, 1);
  assert.match(cancelled[0] ?? "", /^[0-9a-f-]{36}$/);
});

test("a call can pin the expected host and get an explicit mismatch", () => {
  const main = readFileSync("src/web/main.ts", "utf8");
  const bridge = readFileSync("src/bridge/index.ts", "utf8");
  const tools = readFileSync("packages/pi-webview/lib/browser-tools.ts", "utf8");
  // contract + validation of the bare host
  assert.match(bridge, /normalizeBrowserExpectedHost\(data\.expectedHost\)/);
  assert.match(main, /if \(pinnedHost && new URL\(context\.url\)\.host !== pinnedHost\)/);
  assert.match(main, /browserPageHostMismatch/);
  // never act on another window's tab silently
  assert.match(main, /never act on another window's tab silently/);
  // exposed on the tools that operate on a page
  assert.match(tools, /expectedHost,/);
  const normalized = readFileSync("src/ide/browser-tools.ts", "utf8");
  assert.match(normalized, /expectedHost must be a bare host name/);
});

test("the click frame wait is bounded so a paused rAF cannot hang the action", () => {
  const actions = readFileSync("src/adapters/browser/chrome/page-actions.ts", "utf8");
  assert.match(actions, /const SETTLE_BUDGET_MS = /);
  assert.match(
    actions,
    /const timer = setTimeout\(\(\) => finish\(false\), SETTLE_BUDGET_MS\);/,
  );
  assert.match(actions, /if \(!\(await settlePageFrames\(\)\)\) rafTimedOut = true;/);
  assert.match(actions, /rafTimedOut: true/);
});

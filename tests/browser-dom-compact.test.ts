import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionToolResult } from "../packages/pi-webview/lib/browser-tools.ts";

const pageDom = readFileSync("src/adapters/browser/chrome/page-dom.ts", "utf8");
const serviceWorker = readFileSync(
  "src/adapters/browser/chrome/service-worker.ts",
  "utf8",
);
const tools = readFileSync("packages/pi-webview/lib/browser-tools.ts", "utf8");

test("the compact DOM view excludes executable and template content", () => {
  for (const tag of ["script", "style", "template", "noscript", "svg", "iframe"]) {
    assert.match(pageDom, new RegExp(`"${tag}"`), `${tag} must be skipped`);
  }
});

test("the compact DOM view redacts secrets by default", () => {
  assert.match(pageDom, /const SECRET_HINT =/);
  assert.match(pageDom, /\[redacted\]/);
  assert.match(pageDom, /type === "password" \|\| type === "hidden"/);
  assert.match(pageDom, /SECRET_TEXT\.test/);
});

test("compact DOM is the default and the full DOM stays explicit", () => {
  assert.match(tools, /mode: Type\.Optional\(/);
  assert.match(tools, /compact \(default\) lists visible controls/);
  assert.match(tools, /params\.mode === "full" \? "full" : "compact"/);
  assert.match(
    serviceWorker,
    /request\.operation === "dom" && request\.domMode !== "full"/,
  );
  assert.match(serviceWorker, /domMode: "full"/);
});

test("action results never claim the application outcome", () => {
  const result = actionToolResult({
    ok: true,
    companionProtocol: 2,
    operation: "action",
    url: "https://example.test/settings",
    title: "Settings",
    actionId: "8a44f4c0-0000-4000-8000-000000000000",
    urlBefore: "https://example.test/settings#users",
    urlAfter: "https://example.test/settings#integrationpage",
    actionResults: [
      {
        index: 0,
        type: "click",
        selector: "a#integration",
        target: "a#integration[role=tab]",
        hash: "#integrationpage",
        outcome: "dispatched",
        defaultPrevented: false,
        ok: true,
      },
      {
        index: 1,
        type: "click",
        selector: "a.create",
        target: "a#create",
        hash: "#users",
        outcome: "suppressed",
        defaultPrevented: true,
        defaultActionSuppressed: true,
        ok: true,
      },
    ],
  });
  const text = result.content[0]?.text ?? "";
  assert.match(text, /Dispatched 2 of 2 actions/);
  assert.match(text, /event delivery only/);
  assert.match(text, /Action id: 8a44f4c0/);
  assert.match(
    text,
    /URL before: https:\/\/example\.test\/settings#users → after: https:\/\/example\.test\/settings#integrationpage/,
  );
  assert.match(
    text,
    /a#integration\[role=tab\]; default action left to the browser; hash now #integrationpage/,
  );
  assert.match(text, /browser default suppressed on request/);
});

test('failures are reported as unknown outcome, never as "not executed"', () => {
  assert.match(
    serviceWorker,
    /\/\/ the page may have acted before the failure: never imply "not executed"/,
  );
  assert.match(serviceWorker, /outcome: "unknown"/);
  assert.match(
    readFileSync("src/bridge/browser-control.ts", "utf8"),
    /may have applied the request anyway/,
  );
});

test("an old companion build can never produce a false empty result", async () => {
  const { requireCompanionProtocol, compactDomResult, editorToolResult } =
    await import("../packages/pi-webview/lib/browser-tools.ts");
  // protocol negotiation helper
  assert.throws(
    () => requireCompanionProtocol({ ok: true }, 2, "The compact DOM view"),
    /not supported by the running pi-webview Chrome companion/,
  );
  assert.throws(
    () => requireCompanionProtocol({ ok: true, companionProtocol: 1 }, 2, "x"),
    /chrome:\/\/extensions/,
  );
  requireCompanionProtocol({ ok: true, companionProtocol: 2 }, 2, "x");

  // a compact request answered with a full payload is an error, not "0 controls"
  assert.throws(
    () =>
      compactDomResult({
        ok: true,
        companionProtocol: 2,
        domMode: "full",
        html: "<html></html>",
      }),
    /returned a full DOM payload for a compact request/,
  );

  // duplicate editor ids are refused instead of silently resolving one of them
  assert.throws(
    () =>
      editorToolResult({
        ok: true,
        companionProtocol: 2,
        editors: [
          {
            editorId: "f0:dom-field:0",
            kind: "dom-field",
            verificationLevel: "dom-only",
            readOnly: false,
            visible: false,
            length: 0,
            lines: 1,
            hash: "fnv1a32:811c9dc5:0",
          },
          {
            editorId: "f0:dom-field:0",
            kind: "dom-field",
            verificationLevel: "dom-only",
            readOnly: true,
            visible: false,
            length: 20,
            lines: 1,
            hash: "fnv1a32:f5b45f9d:20",
          },
        ],
      }),
    /duplicate editor ids/,
  );
});

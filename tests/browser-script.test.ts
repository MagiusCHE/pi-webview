import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageScriptResult } from "../src/adapters/browser/chrome/page-script.ts";
import { readFileSync } from "node:fs";
import {
  browserToolPermissionGranted,
  normalizeBrowserPermissionOperations,
} from "../src/web/browser-tool-consent.ts";
import { normalizeBrowserScriptRequest } from "../src/ide/browser-tools.ts";
import { pageScriptExecute } from "../src/adapters/browser/chrome/page-script.ts";
import { registerBrowserTools } from "../packages/pi-webview/lib/browser-tools.ts";

function textOf(result: PageScriptResult): string {
  assert.equal(result.ok, true, result.error);
  assert.equal(typeof result.value, "string");
  return result.value as string;
}

function errorOf(result: PageScriptResult): string {
  assert.equal(result.ok, false, "expected a failure result");
  assert.equal(typeof result.error, "string");
  return result.error as string;
}

test("script request: requires source and bounded timeout", () => {
  assert.deepEqual(normalizeBrowserScriptRequest({ code: "return 1;" }), {
    code: "return 1;",
    timeoutMs: 5_000,
  });
  assert.deepEqual(normalizeBrowserScriptRequest({ code: "return 1;", timeoutMs: 250 }), {
    code: "return 1;",
    timeoutMs: 250,
  });
  assert.throws(() => normalizeBrowserScriptRequest({ code: "   " }), /source/);
  assert.throws(() => normalizeBrowserScriptRequest({ code: "" }), /non-empty/);
  assert.throws(
    () => normalizeBrowserScriptRequest({ code: "return 1;", timeoutMs: 20 }),
    /timeoutMs/,
  );
  assert.throws(
    () => normalizeBrowserScriptRequest({ code: "return 1;", timeoutMs: 60_000 }),
    /timeoutMs/,
  );
  assert.throws(
    () => normalizeBrowserScriptRequest({ code: "x".repeat(20_001) }),
    /too long/,
  );
});

test("script consent is its own class and never implied by other grants", () => {
  assert.ok(normalizeBrowserPermissionOperations(["script"]).includes("script"));
  assert.deepEqual(normalizeBrowserPermissionOperations(["unknown"]), []);
  assert.equal(
    browserToolPermissionGranted("script", "https://a.test", ["dom", "action"], {}),
    false,
  );
  assert.equal(
    browserToolPermissionGranted("script", "https://a.test", ["script"], {}),
    true,
  );
  assert.equal(
    browserToolPermissionGranted("script", "https://a.test", [], {
      sites: { "https://a.test": ["script"] },
    }),
    true,
  );
  assert.equal(
    browserToolPermissionGranted("dom", "https://a.test", ["script"], {}),
    false,
  );
});

test("script tool is registered with its own authorization wording", () => {
  const definitions: Array<{ name: string; description: string }> = [];
  registerBrowserTools({
    registerTool(definition) {
      definitions.push(definition);
    },
  });
  const script = definitions.find(
    (definition) => definition.name === "browser_page_script",
  );
  assert.ok(script, "browser_page_script must exist");
  assert.match(script.description, /script authorization/i);
  assert.match(script.description, /never implied by the DOM or action grants/i);
});

test("page script returns serializable values, including promises", async () => {
  const plain = await pageScriptExecute({
    code: "return {a: 1, b: [2, 3]};",
    timeoutMs: 1_000,
  });
  assert.equal(plain.ok, true);
  assert.equal(plain.type, "object");
  assert.deepEqual(JSON.parse(textOf(plain)), { a: 1, b: [2, 3] });

  const awaited = await pageScriptExecute({
    code: "await new Promise((r) => setTimeout(r, 10)); return 'done';",
    timeoutMs: 1_000,
  });
  assert.equal(awaited.ok, true);
  assert.equal(textOf(awaited), '"done"');
});

test("page script tolerates circular values and functions", async () => {
  const result = await pageScriptExecute({
    code: "const a = {}; a.self = a; return {a, fn() {}, big: 10n};",
    timeoutMs: 1_000,
  });
  assert.equal(result.ok, true);
  const text = textOf(result);
  assert.match(text, /circular/);
  assert.match(text, /\[function (?:fn|anonymous)\]/);
  assert.match(text, /10n/);
});

test("page script truncates large output instead of failing", async () => {
  const result = await pageScriptExecute({
    code: "return 'x'.repeat(40000);",
    timeoutMs: 1_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.match(textOf(result), /truncated/);
});

test("page script reports thrown errors and timeouts", async () => {
  const failure = await pageScriptExecute({
    code: "throw new Error('boom');",
    timeoutMs: 1_000,
  });
  assert.match(errorOf(failure), /boom/);

  const timeout = await pageScriptExecute({
    code: "await new Promise((r) => setTimeout(r, 400)); return 1;",
    timeoutMs: 120,
  });
  assert.match(errorOf(timeout), /timed out after 120 ms/);
});

test("arbitrary JavaScript stays behind the dedicated consent class", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const pageScript = readFileSync("src/adapters/browser/chrome/page-script.ts", "utf8");
  const consent = readFileSync("src/web/browser-tool-consent.ts", "utf8");
  // the only dynamic-evaluation site is the packaged page function
  assert.match(pageScript, /new Function\(/);
  assert.doesNotMatch(serviceWorker, /new Function\(|eval\(/);
  // execution requires the script grant and its own consent message
  assert.match(consent, /"script"/);
  assert.match(readFileSync("src/web/main.ts", "utf8"), /browserPermissionScriptConsent/);
  // still no Chrome debugger/CDP shortcut
  assert.doesNotMatch(serviceWorker, /chrome\.debugger/);
});

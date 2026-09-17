import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync("src/adapters/browser/chrome/manifest.json", "utf8"),
) as {
  manifest_version?: number;
  permissions?: string[];
  host_permissions?: string[];
  side_panel?: { default_path?: string };
  background?: { service_worker?: string };
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};

test("Chrome companion is a Manifest V3 side-panel extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel?.default_path, "index.html");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
  assert.ok(manifest.permissions?.includes("sidePanel"));
  assert.ok(manifest.permissions?.includes("tabs"));
  assert.equal(manifest.permissions?.includes("debugger"), false);
});

test("Chrome companion declares page access used by context and tools", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.js, ["content-script.js"]);
});

test("Chrome replaces stale page tracking after an extension reload", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const contentScript = readFileSync(
    "src/adapters/browser/chrome/content-script.ts",
    "utf8",
  );
  assert.match(serviceWorker, /files: \["content-script\.js"\]/);
  assert.match(contentScript, /__piWebviewBrowserContentScriptCleanup/);
  assert.match(contentScript, /function sendRuntimeMessage/);
  assert.match(contentScript, /chrome\.runtime\.sendMessage\(message\)/);
});

test("Chrome stores resumed sessions per browser window", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const runtime = readFileSync("src/adapters/browser/runtime.ts", "utf8");
  assert.match(serviceWorker, /chrome\.storage\.session/);
  assert.doesNotMatch(
    serviceWorker,
    /sessionIntent:\s*browserSessionIntentFromServerUrl/,
  );
  assert.match(runtime, /WINDOW_SESSION_INTENT_PREFIX/);
  assert.match(runtime, /return "new=1"/);
});

test("settings expose one shared Apply only when staged values are dirty", () => {
  const html = readFileSync("src/web/index.html", "utf8");
  assert.equal((html.match(/id="settings-apply"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="settings-browser-save"/);
  assert.doesNotMatch(html, /id="pidev-apply"/);
  assert.doesNotMatch(html, /id="cli-apply"/);
});

test("Chrome browser-tool grants expose three scopes and a reset control", () => {
  const html = readFileSync("src/web/index.html", "utf8");
  const main = readFileSync("src/web/main.ts", "utf8");
  assert.match(html, /settings-browser-reset-permissions/);
  assert.match(main, /showBrowserPermissionDialog/);
  assert.match(main, /browserPermissionAllowSession/);
  assert.match(main, /browserPermissionAllowSite/);
  assert.match(main, /browserPermissionAllowGlobal/);
  assert.match(main, /type: "setSessionSettings"/);
  assert.match(main, /browserToolPermissions: browserPersistentPermissions/);
});

test("Chrome permits confirmed HTTP(S) navigation from a restricted source page", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const main = readFileSync("src/web/main.ts", "utf8");
  assert.match(main, /browserToolPermissionOrigin/);
  assert.match(main, /expectedUrl: context\.url/);
  assert.match(serviceWorker, /navigation\?\.type !== "navigate"/);
  assert.match(serviceWorker, /request\.expectedUrl/);
  assert.match(
    serviceWorker,
    /chrome\.tabs\.update\(tab\.id, \{ url: navigation\.url \}\)/,
  );
});

test("Chrome page actions are structured and do not evaluate remote code", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const contentScript = readFileSync(
    "src/adapters/browser/chrome/content-script.ts",
    "utf8",
  );
  assert.match(serviceWorker, /function executePageActions/);
  assert.match(serviceWorker, /action\.type === "click"/);
  assert.match(serviceWorker, /action\.target === "visual"/);
  assert.match(serviceWorker, /action\.type === "click_at"/);
  assert.match(serviceWorker, /document\.elementFromPoint\(action\.x, action\.y\)/);
  assert.match(serviceWorker, /new PointerEvent\("pointerdown"/);
  assert.match(serviceWorker, /new MouseEvent\("click"/);
  assert.match(serviceWorker, /action\.type === "type"/);
  assert.match(serviceWorker, /action\.type === "class"/);
  assert.match(serviceWorker, /classList\.add/);
  assert.match(serviceWorker, /action\.type === "style"/);
  assert.match(serviceWorker, /style\.setProperty/);
  assert.match(serviceWorker, /scrollIntoView/);
  assert.match(serviceWorker, /chrome\.tabs\.reload/);
  assert.match(serviceWorker, /chrome\.tabs\.update/);
  assert.match(serviceWorker, /new InputEvent\("beforeinput"/);
  assert.match(serviceWorker, /getTargetRanges/);
  assert.match(serviceWorker, /execCommand\("insertText"/);
  assert.match(serviceWorker, /document\.querySelector\(selector\)/);
  assert.match(serviceWorker, /world: "MAIN"/);
  assert.match(serviceWorker, /rejected the text insertion/);
  assert.doesNotMatch(serviceWorker, /\beval\s*\(|new Function\s*\(/);
  assert.doesNotMatch(serviceWorker, /chrome\.debugger/);
  assert.match(contentScript, /"page-action"/);
});

test("package scripts build Chrome before assembling the pi package", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["package:chrome"],
    "node tools/build-chrome-extension.mjs",
  );
  assert.match(packageJson.scripts?.["package:pi"] ?? "", /package:chrome/);
});

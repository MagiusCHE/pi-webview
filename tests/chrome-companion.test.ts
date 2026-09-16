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
});

test("Chrome companion declares page access used by context and tools", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.js, ["content-script.js"]);
});

test("Chrome reinjects page tracking idempotently after an extension reload", () => {
  const serviceWorker = readFileSync(
    "src/adapters/browser/chrome/service-worker.ts",
    "utf8",
  );
  const contentScript = readFileSync(
    "src/adapters/browser/chrome/content-script.ts",
    "utf8",
  );
  assert.match(serviceWorker, /files: \["content-script\.js"\]/);
  assert.match(contentScript, /__piWebviewBrowserContentScriptLoaded/);
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
  assert.match(serviceWorker, /new PointerEvent\("pointerdown"/);
  assert.match(serviceWorker, /new MouseEvent\("click"/);
  assert.match(serviceWorker, /action\.type === "type"/);
  assert.match(serviceWorker, /execCommand\("insertText"/);
  assert.doesNotMatch(serviceWorker, /\beval\s*\(|new Function\s*\(/);
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

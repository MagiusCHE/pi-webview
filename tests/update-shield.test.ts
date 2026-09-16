import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { updateShieldVisualState } from "../src/web/update-shield.ts";

test("a failed update can restore the enabled yellow retry shield", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: false,
      hasUpdate: true,
      restartRequired: false,
    }),
    { disabled: false, tone: "warn", tooltip: "available" },
  );
});

test("a successful update leaves a disabled blue shield without the warn pulse", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: false,
      hasUpdate: false,
      restartRequired: true,
    }),
    { disabled: true, tone: "ok", tooltip: "restartRequired" },
  );
});

test("the header shield remains visible before startup info is available", () => {
  const html = readFileSync("src/web/index.html", "utf8");
  const extension = readFileSync("packages/pi-webview/extension.ts", "utf8");
  const button = /<button\s+id="btn-update-pi"[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
  assert.ok(button);
  assert.doesNotMatch(button, /\bhidden\b/);
  assert.match(
    extension,
    /const info = collectStartupInfo\(c\.cwd \?\? process\.cwd\(\)\);[\s\S]*?writeStartupInfoFile\(info\);/,
  );
});

test("an update in progress remains disabled and yellow", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: true,
      hasUpdate: true,
      restartRequired: false,
    }),
    { disabled: true, tone: "warn", tooltip: "checking" },
  );
});

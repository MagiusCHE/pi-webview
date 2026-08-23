import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readVsixVersion } from "../packages/pi-webview/lib/vsix-version.ts";

const VSIX = join("packages", "pi-webview", "companion", "pi-webview-ide.vsix");

test("readVsixVersion: estrae la versione dal vsix reale del companion", () => {
  const v = readVsixVersion(VSIX);
  assert.ok(v, "versione attesa");
  assert.match(v, /^\d+\.\d+\.\d+$/);
});

test("readVsixVersion: undefined su file inesistente", () => {
  assert.throws(() => readVsixVersion("non-esiste.vsix"));
});

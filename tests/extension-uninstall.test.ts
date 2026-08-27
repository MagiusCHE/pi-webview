// Unit tests for the runtime package-ref resolution used by /piw
// uninstall (findInstalledRef, packages/pi-webview/extension.ts). The ref
// must match what `pi list` shows: npm installs are `npm:<name>`, local
// installs are the relative path registered in ~/.pi/agent/settings.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findInstalledRef } from "../packages/pi-webview/extension.ts";

const win = process.platform === "win32";
const AGENT = win
  ? "C:\\Users\\me\\.pi\\agent"
  : "/home/me/.pi/agent";
const ROOT = win
  ? "C:\\Users\\me\\source\\repos\\pi-webview\\packages\\pi-webview"
  : "/home/me/source/repos/pi-webview/packages/pi-webview";

test("findInstalledRef: matches the npm entry (exact)", () => {
  assert.equal(
    findInstalledRef(["npm:@magiusche/pi-webview"], ROOT, AGENT),
    "npm:@magiusche/pi-webview",
  );
});

test("findInstalledRef: matches the npm entry (versioned)", () => {
  assert.equal(
    findInstalledRef(["npm:@magiusche/pi-webview@0.2.1"], ROOT, AGENT),
    "npm:@magiusche/pi-webview@0.2.1",
  );
});

test("findInstalledRef: matches a local path entry resolved against the agent dir", () => {
  const rel = win
    ? "..\\..\\source\\repos\\pi-webview\\packages\\pi-webview"
    : "../../source/repos/pi-webview/packages/pi-webview";
  assert.equal(
    findInstalledRef(["npm:pi-agent-extensions", rel], ROOT, AGENT),
    rel,
  );
});

test("findInstalledRef: returns null when this package is not listed", () => {
  assert.equal(findInstalledRef(["npm:pi-agent-extensions"], ROOT, AGENT), null);
});

test("findInstalledRef: skips git entries and unrelated paths", () => {
  assert.equal(
    findInstalledRef(
      ["git:https://example.com/other.git", "npm:other-pkg"],
      ROOT,
      AGENT,
    ),
    null,
  );
});

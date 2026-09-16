import assert from "node:assert/strict";
import test from "node:test";
import { sessionPickStrategy } from "../src/web/session-routing.ts";

test("Chrome resumes cross-workspace sessions without forking", () => {
  assert.equal(sessionPickStrategy("browser-extension", true), "reload-original");
});

test("same-workspace sessions always switch directly", () => {
  for (const mode of ["browser-extension", "standalone", "vscode", "ide"] as const) {
    assert.equal(sessionPickStrategy(mode, false), "switch");
  }
});

test("standalone and fixed-workspace IDEs retain their distinct cross-workspace flows", () => {
  assert.equal(sessionPickStrategy("standalone", true), "choose-standalone-action");
  assert.equal(sessionPickStrategy("vscode", true), "confirm-ide-fork");
  assert.equal(sessionPickStrategy("ide", true), "confirm-ide-fork");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  browserServerSettingDirty,
  settingRecordsEqual,
  settingsApplyNeeded,
} from "../src/web/settings-apply.ts";

test("the shared settings Apply stays hidden without changes", () => {
  assert.equal(
    browserServerSettingDirty(
      "http://127.0.0.1:7361",
      "http://127.0.0.1:7361",
      true,
      true,
    ),
    false,
  );
  assert.equal(settingsApplyNeeded(false, false, 0), false);
});

test("any staged restart-sensitive section reveals the same Apply", () => {
  assert.equal(
    browserServerSettingDirty(
      "http://127.0.0.1:7362",
      "http://127.0.0.1:7361",
      true,
      true,
    ),
    true,
  );
  assert.equal(settingsApplyNeeded(true, false, 0), true);
  assert.equal(settingsApplyNeeded(false, true, 0), true);
  assert.equal(settingsApplyNeeded(false, false, 1), true);
});

test("CLI flag ordering never creates false dirtiness", () => {
  assert.equal(
    settingRecordsEqual({ alpha: true, beta: "x" }, { beta: "x", alpha: true }),
    true,
  );
  assert.equal(settingRecordsEqual({ alpha: true }, { alpha: false }), false);
});

test("browser URL loading and non-Chrome runtimes never create false dirtiness", () => {
  assert.equal(browserServerSettingDirty("changed", "saved", false, true), false);
  assert.equal(browserServerSettingDirty("changed", "saved", true, false), false);
});

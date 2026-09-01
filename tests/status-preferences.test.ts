import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveStatsBarCompact,
  normalizeHiddenStatusKeys,
  setStatusKeyHidden,
} from "../src/web/status-preferences.ts";

test("hidden status keys: normalizes, hides and restores by stable status key", () => {
  assert.deepEqual(normalizeHiddenStatusKeys(["mcp", "", "mcp", 3, "control"]), [
    "mcp",
    "control",
  ]);
  assert.deepEqual(setStatusKeyHidden(["mcp"], "control", true), ["mcp", "control"]);
  assert.deepEqual(setStatusKeyHidden(["mcp", "control"], "mcp", false), ["control"]);
});

test("compact preference is independent after save and preserves legacy placement", () => {
  assert.equal(effectiveStatsBarCompact(undefined, "above"), true);
  assert.equal(effectiveStatsBarCompact(undefined, "below"), true);
  assert.equal(effectiveStatsBarCompact(undefined, "topbar"), false);
  assert.equal(effectiveStatsBarCompact(false, "above"), false);
  assert.equal(effectiveStatsBarCompact(true, "topbar"), true);
});

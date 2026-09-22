import assert from "node:assert/strict";
import test from "node:test";
import { clampThinkingLevel } from "../src/web/thinking-levels.ts";

test("a supported thinking level is kept as-is", () => {
  const levels = ["off", "low", "medium"];
  assert.equal(clampThinkingLevel("low", levels), "low");
  assert.equal(clampThinkingLevel("off", levels), "off");
});

test("an unsupported thinking level is clamped to the highest supported one", () => {
  // model switch: "high" no longer exists, the new model stops at "medium"
  assert.equal(clampThinkingLevel("high", ["off", "minimal", "low", "medium"]), "medium");
  assert.equal(clampThinkingLevel("xhigh", ["off", "low"]), "low");
});

test("a non-reasoning model keeps thinking off", () => {
  assert.equal(clampThinkingLevel("high", ["off"]), "off");
  // defensive: an empty list must never produce a stale level
  assert.equal(clampThinkingLevel("high", []), "");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("expanded status slots wrap their own text, including ANSI spans and long words", () => {
  const css = readFileSync("src/web/style.css", "utf8");
  const rule = /body\.stats-bar-expanded \.stats-slot \{([^}]*)\}/.exec(css);
  assert.ok(rule, "expanded layout must override each slot, not just its container");
  const declarations = rule[1] ?? "";
  // Inline text flow lets colored spans wrap naturally instead of staying
  // separate, non-wrapping flex items inside the button.
  assert.match(declarations, /display: block;/);
  assert.match(declarations, /max-width: 100%;/);
  assert.match(declarations, /white-space: pre-wrap;/);
  assert.match(declarations, /overflow-wrap: anywhere;/);
  assert.match(declarations, /overflow: visible;/);
  assert.match(declarations, /text-overflow: clip;/);
  const separator =
    /body\.stats-bar-expanded \.stats-slot \+ \.stats-slot::before \{([^}]*)\}/.exec(css);
  assert.ok(separator, "slot separators must remain visible in inline text flow");
  assert.match(separator[1] ?? "", /display: inline-block;/);
});

test("compact status slots retain single-line truncation", () => {
  const css = readFileSync("src/web/style.css", "utf8");
  const rule = /^\.stats-slot \{([^}]*)\}/m.exec(css);
  assert.ok(rule);
  const declarations = rule[1] ?? "";
  assert.match(declarations, /white-space: nowrap;/);
  assert.match(declarations, /overflow: hidden;/);
  assert.match(declarations, /text-overflow: ellipsis;/);
});

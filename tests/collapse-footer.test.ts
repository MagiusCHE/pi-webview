import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLAPSE_FOOTER_MIN_REM,
  joinCollapseHeaderParts,
  shouldShowCollapseFooter,
} from "../src/web/collapse-footer.ts";

test("collapse footer repeats header parts with readable separators", () => {
  assert.equal(
    joinCollapseHeaderParts(["Agentic thinking", "thought 2", "bash 4", "92s"]),
    "Agentic thinking · thought 2 · bash 4 · 92s",
  );
  assert.equal(joinCollapseHeaderParts([" read ", "", "  file.ts  "]), "read · file.ts");
});

test("collapse footer appears only for expanded blocks taller than 5rem", () => {
  assert.equal(COLLAPSE_FOOTER_MIN_REM, 5);
  assert.equal(shouldShowCollapseFooter(true, 81, 0, 16), true);
  assert.equal(shouldShowCollapseFooter(true, 80, 0, 16), false);
  assert.equal(shouldShowCollapseFooter(false, 200, 0, 16), false);
});

test("collapse footer block measurement excludes an already visible footer", () => {
  assert.equal(shouldShowCollapseFooter(true, 109, 28, 16), true);
  assert.equal(shouldShowCollapseFooter(true, 108, 28, 16), false);
});

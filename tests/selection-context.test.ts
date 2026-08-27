import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachEditorSelectionContext,
  stripEditorSelectionContext,
  type ActiveEditorSelection,
} from "../src/web/selection-context.ts";

const selection: ActiveEditorSelection = {
  filePath: "C:\\work\\app\\src\\main.ts",
  workspaceFolder: "C:\\work\\app",
  ranges: [
    {
      text: 'const answer = "42";\nconsole.log(answer);',
      selection: {
        start: { line: 9, character: 2 },
        end: { line: 10, character: 20 },
      },
    },
  ],
};

test("selection context: attaches exact text, path and one-based coordinates", () => {
  const result = attachEditorSelectionContext("What did I select?", selection);
  assert.match(result, /^What did I select\?\n\n<pi-webview-editor-selection>/);
  assert.match(result, /C:\\\\work\\\\app\\\\src\\\\main\.ts/);
  assert.match(result, /const answer = \\"42\\";\\nconsole\.log\(answer\);/);
  assert.match(result, /"line": 10/);
  assert.match(result, /"column": 3/);
  assert.match(result, /<\/pi-webview-editor-selection>$/);
});

test("selection context: transport block is hidden from chat rendering", () => {
  const result = attachEditorSelectionContext("Inspect this code", selection);
  assert.equal(stripEditorSelectionContext(result), "Inspect this code");
});

test("selection context: no active ranges leaves the prompt untouched", () => {
  assert.equal(attachEditorSelectionContext("Hello", null), "Hello");
  assert.equal(
    attachEditorSelectionContext("Hello", { ...selection, ranges: [] }),
    "Hello",
  );
});

test("selection context: stripping leaves ordinary user text unchanged", () => {
  assert.equal(stripEditorSelectionContext("ordinary text"), "ordinary text");
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizePersistedEditorSelection } from "../src/adapters/vscode/selection-state.ts";

const persisted = {
  filePath: "/workspace/src/main.ts",
  workspaceFolder: "/workspace",
  ranges: [
    {
      text: "selected text",
      selection: {
        start: { line: 3, character: 2 },
        end: { line: 3, character: 15 },
      },
    },
  ],
};

test("VS Code selection survives workspace-state serialization", () => {
  assert.deepEqual(
    normalizePersistedEditorSelection(JSON.parse(JSON.stringify(persisted))),
    persisted,
  );
});

test("invalid or empty persisted selections are discarded", () => {
  assert.equal(normalizePersistedEditorSelection(null), null);
  assert.equal(normalizePersistedEditorSelection({ ranges: [] }), null);
  assert.equal(
    normalizePersistedEditorSelection({
      ranges: [
        {
          text: "x",
          selection: {
            start: { line: -1, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    }),
    null,
  );
});

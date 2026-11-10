import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ExtensionUiState, recoverableStatuses } from "../src/ide/extension-ui-state.ts";

const status = (statusKey: string, statusText?: string) => ({
  type: "extension_ui_request",
  method: "setStatus",
  statusKey,
  statusText,
});

test("hosts retain the last status by key, including explicit clears", () => {
  const state = new ExtensionUiState();
  state.record(status("mcp", "connecting"));
  state.record(status("mcp", "14 servers"));
  state.record(status("account", "signed in"));
  state.record(status("account"));
  assert.deepEqual(state.statuses(), [
    { statusKey: "mcp", statusText: "14 servers" },
    { statusKey: "account", statusText: "" },
  ]);
  state.clear();
  assert.deepEqual(state.statuses(), []);
});

test("state replay never caches interactive dialogs, notifications or model messages", () => {
  const state = new ExtensionUiState();
  for (const method of ["select", "confirm", "input", "editor", "notify"])
    state.record({ type: "extension_ui_request", method, id: "do-not-replay" });
  state.record({ type: "message_start", message: "not presentation state" });
  state.record({
    type: "extension_ui_request",
    method: "setWidget",
    widgetKey: "widget",
    widgetLines: ["text"],
  });
  assert.equal(state.events().length, 1);
  assert.deepEqual(state.statuses(), []);
});

test("a delayed snapshot cannot undo newer live status values or clears", () => {
  const snapshot = [
    { statusKey: "mcp", statusText: "old" },
    { statusKey: "account", statusText: "old" },
    { statusKey: "session", statusText: "recovered" },
  ];
  assert.deepEqual(
    recoverableStatuses(
      snapshot,
      new Map([
        ["mcp", 2],
        ["account", 3],
      ]),
      1,
    ),
    [{ statusKey: "session", statusText: "recovered" }],
  );
  assert.deepEqual(recoverableStatuses(snapshot, new Map(), 1), snapshot);
  assert.deepEqual(recoverableStatuses(undefined, new Map(), 0), []);
  assert.deepEqual(
    recoverableStatuses([null, {}, { statusKey: "mcp", statusText: 1 }], new Map(), 0),
    [],
  );
});

test("every host exposes the same optional statusSnapshot without a new core RPC", () => {
  for (const file of [
    "src/bridge/index.ts",
    "src/adapters/vscode/host.ts",
    "src/adapters/visualstudio/src/PiWebview.Vs/Host/IdeBridge.cs",
  ]) {
    assert.ok(readFileSync(file, "utf8").includes("statusSnapshot"), file);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  editArgumentPairs,
  editArgumentPath,
  readArgumentEntries,
  shellArgumentView,
  shellResultExitCode,
  writeArgumentContent,
} from "../src/web/tool-arguments.ts";

test("read arguments become an ordered key-value list without command", () => {
  assert.deepEqual(
    readArgumentEntries(
      JSON.stringify({
        path: "/workspace/src/main.ts",
        offset: 12,
        limit: 40,
        command: "internal transport detail",
      }),
    ),
    [
      { key: "path", value: "/workspace/src/main.ts" },
      { key: "offset", value: "12" },
      { key: "limit", value: "40" },
    ],
  );
});

test("read arguments hide incomplete JSON instead of exposing raw fragments", () => {
  assert.deepEqual(readArgumentEntries('{"path":"/work'), []);
  assert.deepEqual(readArgumentEntries(""), []);
});

test("read argument values remain readable for non-string values", () => {
  assert.deepEqual(readArgumentEntries({ path: null, enabled: true, ranges: [1, 2] }), [
    { key: "path", value: "null" },
    { key: "enabled", value: "true" },
    { key: "ranges", value: "[1,2]" },
  ]);
});

test("write exposes only content without further text transformations", () => {
  const content = "first line\n\tsecond line\\n  trailing spaces  ";
  const raw = JSON.stringify({
    path: "/workspace/generated.txt",
    content,
    command: "internal transport detail",
  });
  assert.equal(writeArgumentContent(raw), content);
});

test("write hides incomplete envelopes and non-string content", () => {
  assert.equal(writeArgumentContent('{"content":"partial'), null);
  assert.equal(writeArgumentContent({ content: 42 }), null);
  assert.equal(writeArgumentContent({ path: "/tmp/file" }), null);
});

test("edit exposes its path and every exact search-replace pair", () => {
  const edits = [
    { oldText: "first\n  value", newText: "first\n\tvalue" },
    { oldText: "literal\\n", newText: "literal\n" },
  ];
  const raw = JSON.stringify({
    path: "/workspace/src/main.ts",
    command: "internal transport detail",
    edits,
  });
  assert.equal(editArgumentPath(raw), "/workspace/src/main.ts");
  assert.deepEqual(editArgumentPairs(raw), [
    { search: edits[0]!.oldText, replace: edits[0]!.newText },
    { search: edits[1]!.oldText, replace: edits[1]!.newText },
  ]);
});

test("edit hides incomplete envelopes and malformed items", () => {
  assert.equal(editArgumentPath('{"path":"partial'), null);
  assert.deepEqual(
    editArgumentPairs({
      edits: [null, { oldText: "valid", newText: "replacement" }, { oldText: 1 }],
    }),
    [{ search: "valid", replace: "replacement" }],
  );
});

test("shell exposes timeout and command without further text transformations", () => {
  const command = "printf 'first\\n'\necho \"second\"";
  assert.deepEqual(shellArgumentView(JSON.stringify({ command, timeout: 30 })), {
    command,
    timeout: "30",
  });
  assert.deepEqual(shellArgumentView({ command, timeout: undefined }), {
    command,
    timeout: null,
  });
});

test("shell hides incomplete envelopes", () => {
  assert.equal(shellArgumentView('{"command":"echo'), null);
  assert.equal(shellArgumentView({ timeout: 10 }), null);
});

test("shell result resolves success, numeric errors and unavailable error codes", () => {
  assert.equal(shellResultExitCode("output", false), 0);
  assert.equal(shellResultExitCode("output\n\nCommand exited with code 17", true), 17);
  assert.equal(shellResultExitCode("Command timed out after 2 seconds", true), null);
  assert.equal(shellResultExitCode("output", true, 9), 9);
});

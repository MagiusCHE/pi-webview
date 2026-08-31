import { test } from "node:test";
import assert from "node:assert/strict";
import { fileManagerCommand, resolveOpenFilePath } from "../src/bridge/open-file.ts";

test("resolveOpenFilePath: relative paths use the active workspace", () => {
  assert.equal(
    resolveOpenFilePath("src/file.ts", "/workspace/project"),
    "/workspace/project/src/file.ts",
  );
  assert.equal(resolveOpenFilePath("/tmp/file.ts", "/workspace/project"), "/tmp/file.ts");
});

test("fileManagerCommand: reveals the file with each platform file manager", () => {
  assert.deepEqual(fileManagerCommand("/tmp/file.ts", "linux"), {
    command: "xdg-open",
    args: ["/tmp"],
  });
  assert.deepEqual(fileManagerCommand("/tmp/file.ts", "darwin"), {
    command: "open",
    args: ["-R", "/tmp/file.ts"],
  });
  assert.deepEqual(fileManagerCommand("C:\\work\\file.ts", "win32"), {
    command: "explorer.exe",
    args: ["/select,C:\\work\\file.ts"],
  });
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { listDirectory } from "../src/bridge/folders.ts";

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-folders-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "Zeta"));
  mkdirSync(join(root, "Alpha folder"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "file.txt"), "not a folder");
  return root;
}

test("folder listings return full native paths and sorted visible directories", (t) => {
  const root = fixture(t);
  assert.deepEqual(listDirectory(root, root), {
    path: root,
    parent: dirname(root),
    dirs: [
      { name: "Alpha folder", path: join(root, "Alpha folder") },
      { name: "Zeta", path: join(root, "Zeta") },
    ],
  });
});

test("typed relative paths resolve against the active workspace, not the bridge cwd", (t) => {
  const root = fixture(t);
  assert.equal(listDirectory("Alpha folder", root).path, join(root, "Alpha folder"));
  assert.equal(listDirectory(join("Zeta", ".."), root).path, root);
  assert.equal(listDirectory(".", root).path, resolve(root));
});

test("empty and hidden folders can be selected directly by path", (t) => {
  const root = fixture(t);
  assert.deepEqual(listDirectory(join(root, ".hidden"), root).dirs, []);
  assert.deepEqual(listDirectory(join(root, "Alpha folder"), root).dirs, []);
});

test("missing paths and files are rejected without creating any folder", (t) => {
  const root = fixture(t);
  assert.throws(() => listDirectory(join(root, "missing"), root), { code: "ENOENT" });
  assert.throws(() => listDirectory(join(root, "file.txt"), root), { code: "ENOTDIR" });
  assert.deepEqual(
    listDirectory(root, root).dirs.map((dir) => dir.name),
    ["Alpha folder", "Zeta"],
  );
});

test("empty or whitespace-only paths never resolve silently to the current folder", (t) => {
  const root = fixture(t);
  for (const path of ["", "   ", "\n\t"]) {
    assert.throws(() => listDirectory(path, root), /folder path is required/);
  }
});

test("the filesystem root has no parent navigation entry", () => {
  const root = parse(process.cwd()).root;
  assert.equal(listDirectory(root, root).parent, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canOpenLocalLinkNatively,
  fileManagerCommand,
  inspectLocalLink,
  nativeOpenCommand,
  pathInWorkspace,
  resolveOpenFilePath,
} from "../src/bridge/open-file.ts";

test("resolveOpenFilePath: relative paths use the active workspace", () => {
  assert.equal(
    resolveOpenFilePath("src/file.ts", "/workspace/project"),
    "/workspace/project/src/file.ts",
  );
  assert.equal(resolveOpenFilePath("/tmp/file.ts", "/workspace/project"), "/tmp/file.ts");
  assert.equal(
    resolveOpenFilePath("src\\file.ts", "C:\\workspace\\project"),
    "C:\\workspace\\project\\src\\file.ts",
  );
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

test("local chat links resolve against the workspace and allow regular files and folders", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piw-open-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const image = join(workspace, "file with spaces.png");
  const outside = join(root, "outside.png");
  await mkdir(workspace);
  await Promise.all([writeFile(image, "image"), writeFile(outside, "outside")]);
  const target = await inspectLocalLink("file with spaces.png", workspace);
  assert.equal(target.path, await realpath(image));
  assert.equal(target.directory, false);
  assert.equal(await pathInWorkspace(target.path, workspace), image);
  const external = await inspectLocalLink("../outside.png", workspace);
  assert.equal(external.path, await realpath(outside));
  assert.equal(await pathInWorkspace(external.path, workspace), undefined);
  assert.equal((await inspectLocalLink(".", workspace)).directory, true);
  await assert.rejects(inspectLocalLink("missing.png", workspace));
  await assert.rejects(inspectLocalLink("//server/share.png", workspace));
  await assert.rejects(inspectLocalLink("C:/file.png:stream", workspace));
  if (process.platform !== "win32") {
    await symlink(outside, join(workspace, "linked.png"));
    assert.equal((await inspectLocalLink("linked.png", workspace)).path, external.path);
    const alias = join(root, "workspace-link");
    await symlink(workspace, alias);
    assert.equal(
      await pathInWorkspace(target.path, alias),
      join(alias, "file with spaces.png"),
    );
  }
});

test("native open uses the actual path as data and refuses directly runnable files", () => {
  const linux = { path: "/tmp/My image [1].PNG", directory: false, executable: false };
  assert.equal(canOpenLocalLinkNatively(linux), true);
  for (const suffix of ["exe", "bat", "ps1", "sh", "desktop", "lnk", "url"]) {
    assert.equal(
      canOpenLocalLinkNatively({ ...linux, path: `/tmp/image.png.${suffix}` }),
      false,
    );
  }
  assert.equal(canOpenLocalLinkNatively({ ...linux, executable: true }), false);
  assert.deepEqual(nativeOpenCommand(linux, "linux"), {
    command: "xdg-open",
    args: [linux.path],
  });
  assert.deepEqual(nativeOpenCommand(linux, "darwin"), {
    command: "open",
    args: [linux.path],
  });
  const folder = { ...linux, path: "/tmp/images", directory: true };
  assert.deepEqual(nativeOpenCommand(folder, "darwin"), {
    command: "open",
    args: ["-a", "Finder", folder.path],
  });
  const bundle = { ...folder, path: "/tmp/App.app" };
  assert.deepEqual(nativeOpenCommand(bundle, "darwin"), {
    command: "open",
    args: ["-R", bundle.path],
  });
  const windows = nativeOpenCommand(
    { ...linux, path: "C:\\file with ' & [ ].png" },
    "win32",
  );
  assert.match(windows.command, /\\powershell\.exe$/i);
  assert.match(windows.args.at(-1)!, /-LiteralPath \$env:PIW_LOCAL_LINK_PATH/);
  assert.equal(windows.env?.PIW_LOCAL_LINK_PATH, "C:\\file with ' & [ ].png");
});

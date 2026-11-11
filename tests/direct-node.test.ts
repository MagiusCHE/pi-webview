import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveDirectNode } from "../src/bridge/spawn.ts";

function fixture(run: (dir: string, shim: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "piw managed install "));
  try {
    run(dir, join(dir, "pi.cmd"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeScript(path: string, content = ""): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

const managedShim = '@ECHO off\r\nnode "%~dp0pi-launcher.js" %*\r\n';

test("resolveDirectNode runs the managed launcher without a shell and preserves arguments", () => {
  fixture((dir, shim) => {
    writeFileSync(shim, managedShim);
    const launcher = join(dir, "pi-launcher.js");
    writeScript(launcher, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    const direct = resolveDirectNode(shim, "win32");
    assert.ok(direct);
    assert.equal(direct.script, launcher);
    // These arguments must remain literal, not be interpreted by cmd.exe.
    const args = [
      "update",
      "--all",
      "--approve",
      "space in argument",
      "& echo unexpected",
    ];
    const stdout = execFileSync(direct.node, [direct.script, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.deepEqual(JSON.parse(stdout), args);
  });
});

test("resolveDirectNode accepts a managed shim with LF line endings", () => {
  fixture((dir, shim) => {
    writeFileSync(shim, managedShim.replace(/\r\n/g, "\n"));
    const launcher = join(dir, "pi-launcher.js");
    writeScript(launcher);
    assert.equal(resolveDirectNode(shim, "win32")?.script, launcher);
  });
});

test("resolveDirectNode rejects a missing managed launcher", () => {
  fixture((_dir, shim) => {
    writeFileSync(shim, managedShim);
    assert.equal(resolveDirectNode(shim, "win32"), null);
  });
});

test("resolveDirectNode rejects a directory in place of the managed launcher", () => {
  fixture((dir, shim) => {
    writeFileSync(shim, managedShim);
    mkdirSync(join(dir, "pi-launcher.js"));
    assert.equal(resolveDirectNode(shim, "win32"), null);
  });
});

test("resolveDirectNode does not select an unrelated sibling launcher", () => {
  fixture((dir, shim) => {
    writeFileSync(shim, '@ECHO off\r\nnode "%~dp0other.js" %*\r\n');
    writeScript(join(dir, "pi-launcher.js"));
    assert.equal(resolveDirectNode(shim, "win32"), null);
  });
});

test("resolveDirectNode keeps npm shim resolution", () => {
  fixture((dir, shim) => {
    const rel = "@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js";
    writeFileSync(shim, `@ECHO off\r\nnode "%~dp0node_modules\\${rel}" %*\r\n`);
    const script = join(dir, "node_modules", ...rel.split("\\"));
    writeScript(script);
    assert.equal(resolveDirectNode(shim, "win32")?.script, script);
  });
});

test("resolveDirectNode rejects npm shim traversal", () => {
  fixture((dir, shim) => {
    writeFileSync(
      shim,
      '@ECHO off\r\nnode "%~dp0node_modules\\..\\pi-launcher.js" %*\r\n',
    );
    writeScript(join(dir, "pi-launcher.js"));
    assert.equal(resolveDirectNode(shim, "win32"), null);
  });
});

test("resolveDirectNode returns null for non-Windows, missing and unreadable shims", () => {
  fixture((dir, shim) => {
    writeFileSync(shim, managedShim);
    writeScript(join(dir, "pi-launcher.js"));
    assert.equal(resolveDirectNode(shim, "linux"), null);
    assert.equal(resolveDirectNode(shim, "darwin"), null);
    assert.equal(resolveDirectNode(null, "win32"), null);
    assert.equal(resolveDirectNode(join(dir, "missing.cmd"), "win32"), null);
  });
});

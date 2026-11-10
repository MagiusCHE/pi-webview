import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { resolveDirectNode, resolvePi } from "../src/bridge/spawn.ts";

// `piw --pi <command|path>` must win over the PATH lookup: the bridge keeps the
// LAST `--pi` occurrence, so piw must resolve the override instead of appending
// a second, resolved value that would silently override the user's choice.
test("resolvePi honours an explicit absolute path", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-pi-"));
  try {
    const bin = join(dir, "pi-custom");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
    const resolved = resolvePi(process.platform, bin);
    assert.equal(resolved.found, true);
    assert.equal(resolved.path, bin);
    assert.equal(resolved.command, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePi reports a missing explicit path instead of falling back", () => {
  const missing = join(tmpdir(), "piw-pi-does-not-exist", "pi");
  const resolved = resolvePi(process.platform, missing);
  assert.equal(resolved.found, false);
  assert.equal(resolved.path, null);
  assert.equal(resolved.command, missing);
});

test("resolvePi resolves a bare override name in PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-path-"));
  const previous = process.env.PATH;
  try {
    const bin = join(
      dir,
      process.platform === "win32" ? "pi-override.cmd" : "pi-override",
    );
    writeFileSync(
      bin,
      process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
    );
    chmodSync(bin, 0o755);
    mkdirSync(dir, { recursive: true });
    process.env.PATH = `${dir}${delimiter}${previous ?? ""}`;
    const resolved = resolvePi(process.platform, "pi-override");
    assert.equal(resolved.found, true);
    assert.equal(resolved.path, bin);
    assert.equal(resolved.command, "pi-override");
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveDirectNode supports Pi's managed sibling launcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-launcher-"));
  try {
    const shim = join(dir, "pi.cmd");
    const script = join(dir, "pi-launcher.js");
    writeFileSync(shim, '@ECHO off\r\nnode "%~dp0pi-launcher.js" %*\r\n');
    writeFileSync(script, "process.exit(0);\n");
    chmodSync(script, 0o755);

    assert.deepEqual(resolveDirectNode(shim, "win32"), {
      node: process.execPath,
      script,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveDirectNode bypasses the managed launcher for RPC stdin", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-managed-"));
  try {
    const agentDir = join(dir, "agent");
    const binDir = join(agentDir, "bin");
    const installRoot = join(agentDir, "install");
    const packageDir = join(
      installRoot,
      "releases",
      "1.2.3",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    const shim = join(binDir, "pi.cmd");
    const launcher = join(binDir, "pi-launcher.js");
    const script = join(packageDir, "dist", "cli.js");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(join(installRoot, "current-version"), "1.2.3\n");
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ bin: { pi: "dist/cli.js" } }),
    );
    writeFileSync(shim, '@ECHO off\r\nnode "%~dp0pi-launcher.js" %*\r\n');
    writeFileSync(launcher, "// managed launcher\n");
    writeFileSync(script, "process.exit(0);\n");
    chmodSync(launcher, 0o755);
    chmodSync(script, 0o755);

    assert.deepEqual(resolveDirectNode(shim, "win32"), {
      node: process.execPath,
      script,
      env: { PI_MANAGED_INSTALL_ROOT: installRoot },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePi without override keeps the default pi lookup", () => {
  const resolved = resolvePi(process.platform);
  assert.equal(resolved.command, process.platform === "win32" ? "pi.cmd" : "pi");
  assert.equal(resolved.found, resolved.path !== null);
});

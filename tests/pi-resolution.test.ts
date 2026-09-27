import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePi } from "../src/bridge/spawn.ts";

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
    const bin = join(dir, "pi-override");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
    mkdirSync(dir, { recursive: true });
    process.env.PATH = `${dir}:${previous ?? ""}`;
    const resolved = resolvePi(process.platform, "pi-override");
    assert.equal(resolved.found, true);
    assert.equal(resolved.path, bin);
    assert.equal(resolved.command, "pi-override");
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePi without override keeps the default pi lookup", () => {
  const resolved = resolvePi(process.platform);
  assert.equal(resolved.command, process.platform === "win32" ? "pi.cmd" : "pi");
  assert.equal(resolved.found, resolved.path !== null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piBinName, findOnPath } from "../src/bridge/spawn.ts";

test("piBinName: pi su linux/mac, pi.cmd su windows", () => {
  assert.equal(piBinName("linux"), "pi");
  assert.equal(piBinName("darwin"), "pi");
  assert.equal(piBinName("win32"), "pi.cmd");
});

test("findOnPath trova un eseguibile nella PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-test-"));
  const bin = join(dir, "pi");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);

  const oldPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.equal(findOnPath("pi"), bin);
    assert.equal(findOnPath("inesistente"), null);
  } finally {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

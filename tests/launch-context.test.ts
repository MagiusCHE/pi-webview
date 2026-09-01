import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeLaunchCwd, resolveLaunchCwd } from "../src/bridge/launch-context.ts";

test("resolveLaunchCwd keeps the directory from which piw was invoked", () => {
  const cwd = mkdtempSync(join(tmpdir(), "piw-launch-cwd-"));
  const home = mkdtempSync(join(tmpdir(), "piw-launch-home-"));
  try {
    assert.equal(
      resolveLaunchCwd(() => cwd, home),
      cwd,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("launch cwd falls back to the user home when cwd is unavailable", () => {
  const home = mkdtempSync(join(tmpdir(), "piw-launch-home-"));
  try {
    assert.equal(
      resolveLaunchCwd(() => {
        throw new Error("cwd unavailable");
      }, home),
      home,
    );
    assert.equal(normalizeLaunchCwd("/missing/piw-directory", home), home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

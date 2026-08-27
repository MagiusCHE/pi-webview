// ensureCompanions progress steps (onStep) — the trace the user sees while
// the check/install runs (piw console, /piw install notify, startup log).
// Uses a FAKE package root (no bundled vsixes): nothing is ever installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCompanions } from "../src/bridge/companions.ts";

test("ensureCompanions reports progress steps when the bundled vsix is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-steps-"));
  const steps: string[] = [];
  const notes = await ensureCompanions(root, { onStep: (s) => steps.push(s) });

  assert.ok(
    steps.some((s) => s.includes("VS Code: bundled vsix unreadable or missing")),
    `expected VS Code vsix step, got: ${steps.join(" | ")}`,
  );
  assert.ok(
    steps.some((s) => s.includes("Visual Studio: companion vsix not bundled")),
    `expected Visual Studio skip step, got: ${steps.join(" | ")}`,
  );
  // one error note (VS Code vsix missing); VS is silently skipped (no note)
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind, "error");
});

test("PI_WEBVIEW_AUTO_INSTALL=0 disables the automatic check with one step", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-env-"));
  process.env.PI_WEBVIEW_AUTO_INSTALL = "0";
  try {
    const steps: string[] = [];
    const notes = await ensureCompanions(root, { onStep: (s) => steps.push(s) });
    assert.equal(steps.length, 1);
    assert.ok(steps[0]?.includes("disabled"), steps[0]);
    assert.equal(notes.length, 0);
  } finally {
    delete process.env.PI_WEBVIEW_AUTO_INSTALL;
  }
});

test("an explicit command (ignoreAutoInstall) still runs with the env off", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-explicit-"));
  process.env.PI_WEBVIEW_AUTO_INSTALL = "0";
  try {
    const steps: string[] = [];
    const notes = await ensureCompanions(root, {
      ignoreAutoInstall: true,
      onStep: (s) => steps.push(s),
    });
    // the real check ran: VS Code vsix step + Visual Studio skip step
    assert.ok(steps.length >= 2, steps.join(" | "));
    assert.equal(notes.length, 1);
  } finally {
    delete process.env.PI_WEBVIEW_AUTO_INSTALL;
  }
});

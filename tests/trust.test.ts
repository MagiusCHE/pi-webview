import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTrust } from "../src/bridge/trust.ts";

test("getTrust: decisione salvata (trust.json) per la cartella o un parent", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-trust-"));
  try {
    writeFileSync(join(dir, "trust.json"), JSON.stringify({ "/work/proj": true }));
    // match esatto
    assert.equal(getTrust("/work/proj", dir).status, "trusted");
    // match parent
    assert.equal(getTrust("/work/proj/sub/deep", dir).status, "trusted");
    // nessuna decisione → ask (default)
    assert.equal(getTrust("/altro", dir).status, "ask");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: decisione negativa e defaultProjectTrust", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-trust-"));
  try {
    writeFileSync(join(dir, "trust.json"), JSON.stringify({ "/work/proj": false }));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ defaultProjectTrust: "always" }),
    );
    // decisione esplicita vince sul default
    assert.equal(getTrust("/work/proj", dir).status, "untrusted");
    // senza decisione → always → trusted
    assert.equal(getTrust("/altro", dir).status, "trusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: file mancanti → ask", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-trust-"));
  try {
    assert.equal(getTrust("/work/proj", dir).status, "ask");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

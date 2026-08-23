import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAttachment, pathExists } from "../src/bridge/attachments.ts";

test("saveAttachment: salva i byte e restituisce il path", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-att-"));
  try {
    const b64 = Buffer.from("hello").toString("base64");
    const res = saveAttachment("test.txt", "text/plain", b64, dir);
    assert.ok(res.path.startsWith(dir));
    assert.equal(readFileSync(res.path, "utf-8"), "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveAttachment: sanifica il nome (niente traversal)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-att-"));
  try {
    const res = saveAttachment(
      "../../etc/passwd",
      "text/plain",
      Buffer.from("x").toString("base64"),
      dir,
    );
    assert.ok(res.path.startsWith(dir), res.path);
    assert.ok(!res.path.includes(".."));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pathExists: vero per file esistenti, falso altrimenti", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-att-"));
  try {
    const res = saveAttachment(
      "esiste.txt",
      "text/plain",
      Buffer.from("x").toString("base64"),
      dir,
    );
    assert.equal(pathExists(res.path), true);
    assert.equal(pathExists(join(dir, "non-esiste.txt")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

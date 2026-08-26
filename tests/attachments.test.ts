import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachFromPath, mimeFromPath } from "../src/bridge/attachments.ts";

test("attachFromPath copia il file e indovina il mime dall'estensione", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-att-test-"));
  try {
    const src = join(dir, "foto.png");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    writeFileSync(src, png);
    const res = attachFromPath(src, join(dir, "out"));
    assert.equal(res.name, "foto.png");
    assert.equal(res.mimeType, "image/png");
    assert.ok(res.dataBase64, "small image gets inline base64");
    assert.ok(existsSync(res.path));
    assert.deepEqual(readFileSync(res.path), png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attachFromPath: file non-immagine senza base64", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-att-test-"));
  try {
    const src = join(dir, "note.md");
    writeFileSync(src, "# ciao");
    const res = attachFromPath(src, join(dir, "out"));
    assert.equal(res.mimeType, "text/markdown");
    assert.equal(res.dataBase64, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attachFromPath fallisce su path inesistente o directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-att-test-"));
  try {
    assert.throws(() => attachFromPath(join(dir, "manca.txt")));
    assert.throws(() => attachFromPath(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mimeFromPath: estensione nota e sconosciuta", () => {
  assert.equal(mimeFromPath("/a/b/logo.JPG"), "image/jpeg");
  assert.equal(mimeFromPath("/a/b/dati.csv"), "text/csv");
  assert.equal(mimeFromPath("/a/b/file.sconosciuto"), "application/octet-stream");
  assert.equal(mimeFromPath("/a/b/noext"), "application/octet-stream");
});

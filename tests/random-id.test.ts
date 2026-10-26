import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomId } from "../src/shared/random-id.ts";

function sequentialBytes(): (array: Uint8Array) => Uint8Array {
  return (array) => {
    for (let index = 0; index < array.length; index += 1) {
      array[index] = index;
    }
    return array;
  };
}

test("randomId: prefers crypto.randomUUID when the context is secure", () => {
  const id = randomId({
    randomUUID: () => "11111111-2222-3333-4444-555555555555",
    getRandomValues: sequentialBytes(),
  });
  assert.equal(id, "11111111-2222-3333-4444-555555555555");
});

test("randomId: falls back to getRandomValues on insecure contexts", () => {
  // plain http:// pages expose crypto without randomUUID
  assert.equal(
    randomId({ getRandomValues: sequentialBytes() }),
    "000102030405060708090a0b0c0d0e0f",
  );
});

test("randomId: survives a randomUUID that throws outside https", () => {
  const id = randomId({
    randomUUID: () => {
      throw new TypeError("crypto.randomUUID is not a function");
    },
    getRandomValues: sequentialBytes(),
  });
  assert.equal(id, "000102030405060708090a0b0c0d0e0f");
});

test("randomId: always produces a usable id without any crypto source", () => {
  const first = randomId({});
  const second = randomId({});
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.match(second, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});

test("Chrome content script never calls crypto.randomUUID directly", () => {
  // a throw there aborts the whole content script before any listener exists
  const contentScript = readFileSync(
    "src/adapters/browser/chrome/content-script.ts",
    "utf8",
  );
  assert.doesNotMatch(contentScript, /crypto\.randomUUID/);
  assert.match(contentScript, /randomId\(\)/);
});

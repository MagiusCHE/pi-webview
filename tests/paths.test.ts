// Windows-aware path equality used for session/workspace matching
// (src/ide/paths.ts): case-insensitive on Windows, exact elsewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isWindowsPath, normalizePathForMatch, samePath } from "../src/ide/paths.ts";

test("samePath: identical paths", () => {
  assert.equal(samePath("C:\\Users\\x\\proj", "C:\\Users\\x\\proj"), true);
  assert.equal(samePath("/home/x/proj", "/home/x/proj"), true);
});

test("samePath: Windows is case-insensitive", () => {
  assert.equal(samePath("c:\\users\\Magius\\proj", "C:\\Users\\magius\\PROJ"), true);
});

test("samePath: Windows drive letter case", () => {
  assert.equal(samePath("c:\\proj", "C:\\proj"), true);
});

test("samePath: forward/backslash separators", () => {
  assert.equal(samePath("C:/Users/x/proj", "C:\\Users\\x\\proj"), true);
});

test("samePath: trailing separator ignored", () => {
  assert.equal(samePath("C:\\Users\\x\\proj\\", "C:\\Users\\x\\proj"), true);
});

test("samePath: different folder on Windows", () => {
  assert.equal(samePath("C:\\Users\\x\\projA", "C:\\Users\\x\\projB"), false);
});

test("samePath: Linux stays case-sensitive", () => {
  assert.equal(samePath("/home/x/proj", "/home/X/proj"), false);
});

test("samePath: null/undefined left", () => {
  assert.equal(samePath(null, "/home/x"), false);
  assert.equal(samePath(undefined, "/home/x"), false);
});

test("isWindowsPath", () => {
  assert.equal(isWindowsPath("C:\\x"), true);
  assert.equal(isWindowsPath("C:/x"), true);
  assert.equal(isWindowsPath("c:\\x"), true);
  assert.equal(isWindowsPath("/home/x"), false);
  assert.equal(isWindowsPath("rel\\path"), true);
});

test("normalizePathForMatch", () => {
  assert.equal(normalizePathForMatch("C:/Users/x\\"), "c:\\users\\x");
});

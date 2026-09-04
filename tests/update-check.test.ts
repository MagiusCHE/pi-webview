// Unit tests for the pi core update check (packages/pi-webview/lib/
// update-check.ts). Only the pure/cache logic is tested: the network and
// the real `pi` binary are NOT touched (the full checkPiUpdate flow is
// best-effort and environment-dependent by design).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_TTL_MS,
  PI_PACKAGE,
  compareVersions,
  parseLatestVersion,
  parseNpmSources,
  readCache,
  updateCheckFile,
} from "../packages/pi-webview/lib/update-check.ts";

test("PI_PACKAGE is the pi core npm package", () => {
  assert.equal(PI_PACKAGE, "@earendil-works/pi-coding-agent");
});

test("compareVersions: numeric parts, not string order", () => {
  assert.ok(compareVersions("0.9.0", "0.10.0") < 0); // 10 > 9
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.ok(compareVersions("1.2", "1.2.0") === 0); // missing part = 0
  assert.ok(compareVersions("1.2.4", "1.2.3") > 0);
});

test("compareVersions: leading v/= and whitespace are stripped", () => {
  assert.equal(compareVersions("v1.2.3", "=1.2.3"), 0);
  assert.equal(compareVersions(" 1.2.3", "1.2.3"), 0);
});

test("parseLatestVersion: npm view --json output (string or array)", () => {
  assert.equal(parseLatestVersion('"0.85.1"'), "0.85.1");
  assert.equal(parseLatestVersion('  "1.0.0-beta.1" \n'), "1.0.0-beta.1");
  // npm 12 returns an array for a single field
  assert.equal(parseLatestVersion('["0.85.0"]'), "0.85.0");
  assert.equal(parseLatestVersion('["0.9.0","1.0.0"]'), "1.0.0");
});

test("parseLatestVersion: garbage is null, never throws", () => {
  assert.equal(parseLatestVersion(""), null);
  assert.equal(parseLatestVersion("not json"), null);
  assert.equal(parseLatestVersion("42"), null); // JSON number, not a version string
  assert.equal(parseLatestVersion("null"), null);
  assert.equal(parseLatestVersion('["x"]'), null);
});

test("updateCheckFile: lives in ~/.pi/pi-webview", () => {
  assert.equal(updateCheckFile("/home/me"), "/home/me/.pi/pi-webview/update-check.json");
});

test("readCache: valid entries are parsed", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-uc-"));
  const file = join(dir, "update-check.json");
  const entry = { at: 123, current: "0.85.0", latest: "0.85.1" };
  writeFileSync(file, JSON.stringify(entry));
  assert.deepEqual(readCache(file), entry);
  // up-to-date cache: latest is explicitly null
  const upToDate = { at: 123, current: "0.85.0", latest: null };
  writeFileSync(file, JSON.stringify(upToDate));
  assert.deepEqual(readCache(file), upToDate);
});

test("readCache: missing/corrupt/malformed → null, never throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-uc-"));
  const missing = join(dir, "nope.json");
  assert.equal(readCache(missing), null);
  const file = join(dir, "update-check.json");
  writeFileSync(file, "not json");
  assert.equal(readCache(file), null);
  writeFileSync(file, JSON.stringify({ at: "x", current: 1, latest: 2 }));
  assert.equal(readCache(file), null);
  writeFileSync(file, JSON.stringify({ at: 1 })); // minimal core-less entry: valid
  assert.deepEqual(readCache(file), { at: 1 });
  // per-package entries: valid ones kept, malformed ones dropped
  writeFileSync(
    file,
    JSON.stringify({
      at: 1,
      current: "0.85.0",
      latest: null,
      packages: {
        ok: { at: 1, current: "1.0.0", latest: "1.1.0" },
        bad: { at: 1, current: "1.0.0" }, // no latest → dropped
      },
    }),
  );
  assert.deepEqual(readCache(file), {
    at: 1,
    current: "0.85.0",
    latest: null,
    packages: { ok: { at: 1, current: "1.0.0", latest: "1.1.0" } },
  });
});

test("parseNpmSources: only npm: sources, deduplicated, tolerant", () => {
  assert.deepEqual(
    parseNpmSources({
      packages: [
        "npm:pi-spark",
        "../../Sources/Personal/pi-webview/packages/pi-webview", // local → skipped
        "git:github.com/user/repo", // git → skipped
        "npm:@scoped/pkg",
        "npm:pi-spark", // duplicate
        "npm:", // empty name
        42, // not a string
        null,
      ],
    }),
    ["pi-spark", "@scoped/pkg"],
  );
  assert.deepEqual(parseNpmSources(null), []);
  assert.deepEqual(parseNpmSources({}), []);
  assert.deepEqual(parseNpmSources({ packages: "nope" }), []);
});

test("cache TTL is one hour", () => {
  assert.equal(CACHE_TTL_MS, 60 * 60 * 1000);
});

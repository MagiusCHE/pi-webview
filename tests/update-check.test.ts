// Unit tests for the pi core update check (packages/pi-webview/lib/
// update-check.ts). Only the PURE logic is tested: the network and the real
// `pi` binary are NOT touched (the full checkPiUpdate flow is best-effort
// and environment-dependent by design). The check is LIVE (no cache): every
// pi process start and every manual `/piw update.check` does fresh registry
// lookups, so a fresh release is seen at the next session start.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PI_PACKAGE,
  compareVersions,
  parseLatestVersion,
  parseNpmSources,
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

test("checkPiUpdate: the module no longer exposes any cache surface", async () => {
  // the 1h cache (update-check.json) was REMOVED: a fresh release must be
  // seen at the next session start, not an hour later — the check is live
  const mod = (await import("../packages/pi-webview/lib/update-check.ts")) as Record<
    string,
    unknown
  >;
  assert.equal(mod.CACHE_TTL_MS, undefined);
  assert.equal(mod.readCache, undefined);
  assert.equal(mod.updateCheckFile, undefined);
});

// Unit tests for the Visual Studio companion version scan
// (findVsixManifestVersion, src/bridge/companions.ts — the centralized
// companion module used by the pi extension and piw).
// The scan mirrors the two real install layouts: admin (/a) into each
// instance's Common7\IDE\Extensions and per-user into
// %LocalAppData%\Microsoft\VisualStudio\<version>_<sku>\Extensions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findVsixManifestVersion,
  findVsixManifestVersions,
  pickHighestVersion,
} from "../src/bridge/companions.ts";

const VS_ID = "PiWebview.Vs.4d433864-8ac9-420a-bc57-700940833fc6";
const MANIFEST = (version: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">\n` +
  `  <Identity Id="${VS_ID}" Version="${version}" Language="en-US" Publisher="pi-webview" />\n` +
  `</PackageManifest>\n`;

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "piw-vs-scan-"));
  return dir;
}

test("findVsixManifestVersion: finds the version in an admin-install layout", () => {
  const root = makeRoot();
  try {
    const extDir = join(
      root,
      "Common7",
      "IDE",
      "Extensions",
      "PiWebview.Vs.4d433864-8ac9-420a-bc57-700940833fc6",
    );
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "extension.vsixmanifest"), MANIFEST("0.1.20"));
    assert.equal(findVsixManifestVersion(root, VS_ID, 6), "0.1.20");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsixManifestVersion: finds the version in a per-user layout", () => {
  const root = makeRoot();
  try {
    const extDir = join(root, "17.0_abcdef", "Extensions", "pi-webview", "0.1.19");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "extension.vsixmanifest"), MANIFEST("0.1.19"));
    assert.equal(findVsixManifestVersion(root, VS_ID, 6), "0.1.19");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsixManifestVersion: returns null when another extension is installed", () => {
  const root = makeRoot();
  try {
    const extDir = join(root, "Extensions", "Other.Vendor.OtherExtension");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, "extension.vsixmanifest"),
      `<Identity Id="Other.Vendor.OtherExtension.00000000-0000-0000-0000-000000000000" Version="9.9.9" />`,
    );
    assert.equal(findVsixManifestVersion(root, VS_ID, 6), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsixManifestVersion: returns empty string when the manifest lacks Version", () => {
  const root = makeRoot();
  try {
    const extDir = join(root, "Extensions", "PiWebview");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "extension.vsixmanifest"), `<Identity Id="${VS_ID}" />`);
    assert.equal(findVsixManifestVersion(root, VS_ID, 6), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsixManifestVersion: skips unreadable dirs and returns null when missing", () => {
  const root = makeRoot();
  try {
    // a FILE named like a dir: readdir throws (ENOTDIR) → skipped
    writeFileSync(join(root, "Extensions"), "not a dir");
    assert.equal(findVsixManifestVersion(root, VS_ID, 6), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsixManifestVersions: collects EVERY copy in a root (stale + current)", () => {
  const root = makeRoot();
  try {
    const stale = join(root, "Common7", "IDE", "Extensions", "PiWebview-stale");
    const current = join(root, "Common7", "IDE", "Extensions", "PiWebview-current");
    mkdirSync(stale, { recursive: true });
    mkdirSync(current, { recursive: true });
    writeFileSync(join(stale, "extension.vsixmanifest"), MANIFEST("0.2.2"));
    writeFileSync(join(current, "extension.vsixmanifest"), MANIFEST("0.2.3"));
    const all = findVsixManifestVersions(root, VS_ID, 6);
    assert.deepEqual([...all].sort(), ["0.2.2", "0.2.3"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pickHighestVersion: stale all-users copy never shadows the current one", () => {
  assert.equal(pickHighestVersion(["0.2.2", "0.2.3"]), "0.2.3");
  assert.equal(pickHighestVersion(["0.2.3", "0.2.2"]), "0.2.3");
  assert.equal(pickHighestVersion(["0.9.9", "0.10.0"]), "0.10.0");
  assert.equal(pickHighestVersion([]), null);
  assert.equal(pickHighestVersion([""]), "");
  assert.equal(pickHighestVersion(["", "0.2.3"]), "0.2.3");
  assert.equal(pickHighestVersion(["0.2.2", ""]), "0.2.2");
});

test("installed scan: admin copy (0.2.2) + per-user copy (0.2.3) → 0.2.3 wins", () => {
  // mirrors the reported bug layout: Common7 holds a stale all-users copy of
  // the previous release, LocalAppData holds the per-user update. The version
  // check must read 0.2.3 (highest), so the next pi start skips the install
  // instead of reinstalling at every session.
  const admin = makeRoot();
  const perUser = makeRoot();
  try {
    const adminExt = join(admin, "Common7", "IDE", "Extensions", "PiWebview");
    const userExt = join(perUser, "18.0_ff9c53f7", "Extensions", "PiWebview");
    mkdirSync(adminExt, { recursive: true });
    mkdirSync(userExt, { recursive: true });
    writeFileSync(join(adminExt, "extension.vsixmanifest"), MANIFEST("0.2.2"));
    writeFileSync(join(userExt, "extension.vsixmanifest"), MANIFEST("0.2.3"));
    const versions = [
      ...findVsixManifestVersions(admin, VS_ID, 6),
      ...findVsixManifestVersions(perUser, VS_ID, 6),
    ];
    assert.equal(pickHighestVersion(versions), "0.2.3");
  } finally {
    rmSync(admin, { recursive: true, force: true });
    rmSync(perUser, { recursive: true, force: true });
  }
});

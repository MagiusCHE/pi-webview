// Unit tests for the companion resolution helpers added with the VS 2022 fix
// (packages/pi-webview/extension.ts): vswhere json parsing, manifest version
// range check and the Level-2 folder scan (install without the `code` CLI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVsInstances,
  isVsVersionSupported,
  findVsCodeCompanionFolder,
  readVsCodeCompanionVersion,
} from "../packages/pi-webview/extension.ts";

// Real vswhere output shape for a machine with VS 2019 + 2022 + 18 (preview),
// like the one where the companion only reached the newest instance.
const VSW_JSON =
  "Visual Studio Locator version 3.1.7+f39851e70f [query version 4.8.41.48107]\n" +
  "[\n" +
  '  { "instanceId": "72878599", "installationPath": "C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2019\\\\Professional", "installationVersion": "16.11.27", "displayName": "Visual Studio Professional 2019" },\n' +
  '  { "instanceId": "9979f966", "installationPath": "C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Professional", "installationVersion": "17.8.34330.188", "displayName": "Visual Studio Professional 2022" },\n' +
  '  { "instanceId": "ff9c53f7", "installationPath": "C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Professional", "installationVersion": "18.0.0-preview", "displayName": "Visual Studio Professional 18" }\n' +
  "]\n";

test("parseVsInstances: parses all instances with their ids (banner stripped)", () => {
  const instances = parseVsInstances(VSW_JSON);
  assert.equal(instances.length, 3);
  assert.deepEqual(instances[1]!, {
    id: "9979f966",
    path: "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional",
    version: "17.8.34330.188",
    displayName: "Visual Studio Professional 2022",
  });
  assert.equal(instances[2]!.id, "ff9c53f7");
});

test("parseVsInstances: drops entries without id or path, tolerates junk", () => {
  const instances = parseVsInstances(
    'junk before [ { "instanceId": "abc", "installationPath": "C:\\\\VS" }, { "installationPath": "C:\\\\no-id" } ]',
  );
  assert.equal(instances.length, 1);
  assert.equal(instances[0]!.id, "abc");
  assert.deepEqual(parseVsInstances("no json here"), []);
  assert.deepEqual(parseVsInstances("[ not json"), []);
});

test("isVsVersionSupported: only the manifest range [17.0, 19.0)", () => {
  assert.equal(isVsVersionSupported("16.11.27"), false); // VS 2019
  assert.equal(isVsVersionSupported("17.8.34330.188"), true); // VS 2022
  assert.equal(isVsVersionSupported("18.0.0-preview"), true); // VS 2026 preview
  assert.equal(isVsVersionSupported("19.0.0"), false); // outside the range
  assert.equal(isVsVersionSupported(""), false);
  assert.equal(isVsVersionSupported("garbage"), false);
});

test("findVsCodeCompanionFolder: finds the companion folder by name", () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-"));
  try {
    mkdirSync(join(root, "other.extension-1.0.0"), { recursive: true });
    mkdirSync(join(root, "magiusche.pi-webview-ide-0.2.0"), { recursive: true });
    mkdirSync(join(root, "magiusche.pi-webview-ide-0.1.19"), { recursive: true });
    assert.equal(
      findVsCodeCompanionFolder(root),
      join(root, "magiusche.pi-webview-ide-0.2.0"),
    );
    // hidden tmp folders (dot-prefixed) are never matched
    mkdirSync(join(root, ".magiusche.pi-webview-ide-0.3.0.tmp"), { recursive: true });
    assert.equal(
      findVsCodeCompanionFolder(root),
      join(root, "magiusche.pi-webview-ide-0.2.0"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findVsCodeCompanionFolder: null when the dir is missing or empty", () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-"));
  try {
    assert.equal(findVsCodeCompanionFolder(join(root, "nope")), null);
    assert.equal(findVsCodeCompanionFolder(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readVsCodeCompanionVersion: reads package.json version", () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-"));
  try {
    const folder = join(root, "magiusche.pi-webview-ide-0.2.0");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "package.json"),
      JSON.stringify({ name: "pi-webview-ide", version: "0.2.0" }),
    );
    assert.equal(readVsCodeCompanionVersion(folder), "0.2.0");
    assert.equal(readVsCodeCompanionVersion(join(root, "missing")), null);
    writeFileSync(join(folder, "package.json"), "not json");
    assert.equal(readVsCodeCompanionVersion(folder), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

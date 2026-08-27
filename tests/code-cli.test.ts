// Unit tests for the companion resolution helpers added with the VS 2022 fix
// (src/bridge/companions.ts — the centralized companion module): vswhere json
// parsing, manifest version range check and the Level-2 folder scan (install
// without the `code` CLI).

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
  ensureCompanions,
  formatCompanionNotes,
  type CompanionNote,
} from "../src/bridge/companions.ts";

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

test("ensureCompanions: PI_WEBVIEW_AUTO_INSTALL=0 disables everything silently", async () => {
  const prev = process.env.PI_WEBVIEW_AUTO_INSTALL;
  try {
    process.env.PI_WEBVIEW_AUTO_INSTALL = "0";
    assert.deepEqual(await ensureCompanions(process.cwd()), []);
  } finally {
    if (prev === undefined) delete process.env.PI_WEBVIEW_AUTO_INSTALL;
    else process.env.PI_WEBVIEW_AUTO_INSTALL = prev;
  }
});

test("formatCompanionNotes: install/update/error notes in it and en", () => {
  const notes: CompanionNote[] = [
    { target: "vscode", kind: "installed", version: "0.2.1" },
    { target: "vscode", kind: "updated", version: "0.2.1", fromVersion: "0.2.0" },
    { target: "vscode", kind: "error", error: "boom" },
    {
      target: "visualstudio",
      kind: "installed",
      version: "0.2.1",
      label: "VS 2022",
    },
    {
      target: "visualstudio",
      kind: "updated",
      version: "0.2.1",
      fromVersion: "0.2.0",
      label: "VS 2026",
    },
    { target: "visualstudio", kind: "error", error: "bang", label: "VS 2022" },
  ];
  const en = formatCompanionNotes(notes, "en", "pi-webview: ");
  const it = formatCompanionNotes(notes, "it", "piw: ");
  assert.equal(
    en[0],
    "pi-webview: companion installed in VS Code (0.2.1). Reload the window to activate the webview.",
  );
  assert.equal(
    en[1],
    "pi-webview: companion updated in VS Code (0.2.0 → 0.2.1). Reload the window to activate the webview.",
  );
  assert.equal(en[2], "pi-webview: companion install failed in VS Code: boom");
  assert.equal(
    en[3],
    "pi-webview: companion installed in Visual Studio (VS 2022, 0.2.1). Reload Visual Studio to activate the webview.",
  );
  assert.equal(
    en[5],
    "pi-webview: companion install failed in Visual Studio (VS 2022): bang",
  );
  assert.equal(
    it[0],
    "piw: companion VS Code installato (0.2.1). Reload della finestra VS Code per attivare la webview.",
  );
  assert.equal(
    it[4],
    "piw: companion Visual Studio aggiornato in VS 2026 (0.2.0 → 0.2.1). Reload di Visual Studio.",
  );
  assert.equal(
    it[5],
    "piw: installazione companion Visual Studio fallita in VS 2022: bang",
  );
});

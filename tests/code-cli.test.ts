// Unit tests for the companion resolution helpers added with the VS 2022 fix
// (src/bridge/companions.ts — the centralized companion module): vswhere json
// parsing, manifest version range check and the Level-2 folder scan (install
// without the `code` CLI).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  parseVsInstances,
  isVsVersionSupported,
  findVsCodeCompanionFolder,
  readVsCodeCompanionVersion,
  vsCodeExtensionsDirs,
  installVsCodeCompanionDirect,
  uninstallVsCodeCompanionDirect,
  ensureCompanions,
  formatCompanionNotes,
  companionReloadHints,
  chromeStoreUrl,
  CHROME_WEB_STORE_ID,
  type CompanionNote,
} from "../src/bridge/companions.ts";
import { readVsixVersion } from "../packages/pi-webview/lib/vsix-version.ts";

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

test("vsCodeExtensionsDirs discovers Remote SSH and desktop destinations", () => {
  const home = mkdtempSync(join(tmpdir(), "piw-vsc-home-"));
  try {
    const server = join(home, ".vscode-server", "extensions");
    const desktop = join(home, ".vscode", "extensions");
    mkdirSync(server, { recursive: true });
    mkdirSync(desktop, { recursive: true });
    assert.deepEqual(vsCodeExtensionsDirs({ homeDir: home, agentFolder: "relative" }), [
      { dir: server, label: "VS Code Server" },
      { dir: desktop, label: "VS Code Desktop" },
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("vsCodeExtensionsDirs deduplicates VSCODE_AGENT_FOLDER and skips missing dirs", () => {
  const home = mkdtempSync(join(tmpdir(), "piw-vsc-home-"));
  try {
    const agent = join(home, ".vscode-server");
    mkdirSync(join(agent, "extensions"), { recursive: true });
    assert.deepEqual(vsCodeExtensionsDirs({ homeDir: home, agentFolder: agent }), [
      { dir: join(agent, "extensions"), label: "VS Code Agent" },
    ]);
    assert.deepEqual(
      vsCodeExtensionsDirs({ homeDir: join(home, "missing"), agentFolder: "relative" }),
      [],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const realVsix = join("packages", "pi-webview", "companion", "pi-webview-ide.vsix");
const realVsixVersion = readVsixVersion(realVsix);
if (!realVsixVersion) throw new Error("bundled VS Code companion version is missing");

function directTarget(
  dir: string,
  label = "Test VS Code",
): { dir: string; label: string } {
  return { dir, label };
}

test("direct VSIX install skips silently when no destination is recognized", async () => {
  const steps: Array<{ text: string; action?: boolean }> = [];
  const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, false, {
    targets: [],
    onStep: (text, action) => steps.push({ text, action }),
    clearReload: () => assert.fail("an absent installation must not change reload state"),
  });
  assert.deepEqual(notes, []);
  assert.equal(steps.length, 1);
  assert.notEqual(steps[0]?.action, true);
});

function seedVsCodeCompanion(dir: string, version: string): string {
  const folder = join(dir, `magiusche.pi-webview-ide-${version}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ name: "pi-webview-ide", publisher: "magiusche", version }),
  );
  return folder;
}

test("direct VSIX install promotes extension payload without archive metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-direct-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, false, {
      targets: [directTarget(extensions)],
      clearReload: () => {},
    });
    assert.deepEqual(notes, [
      { target: "vscode", kind: "installed", version: realVsixVersion },
    ]);
    const installed = join(extensions, `magiusche.pi-webview-ide-${realVsixVersion}`);
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    assert.equal(manifest.version, realVsixVersion);
    assert.equal(existsSync(join(installed, "extension", "package.json")), false);
    assert.equal(existsSync(join(installed, "extension.vsixmanifest")), false);
    assert.equal(existsSync(join(installed, "[Content_Types].xml")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct VSIX install leaves an already-current companion untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-current-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const installed = seedVsCodeCompanion(extensions, realVsixVersion);
    const marker = join(installed, "keep-me");
    writeFileSync(marker, "unchanged");
    let cleared = 0;
    const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, false, {
      targets: [directTarget(extensions)],
      clearReload: () => cleared++,
    });
    assert.deepEqual(notes, []);
    assert.equal(readFileSync(marker, "utf8"), "unchanged");
    assert.equal(cleared, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct VSIX update replaces an older copy and requests reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-update-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const previous = seedVsCodeCompanion(extensions, "0.1.0");
    const reloads: string[] = [];
    const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, false, {
      targets: [directTarget(extensions)],
      writeReload: (version) => reloads.push(version),
    });
    assert.deepEqual(notes, [
      {
        target: "vscode",
        kind: "updated",
        version: realVsixVersion,
        fromVersion: "0.1.0",
      },
    ]);
    assert.equal(existsSync(previous), false);
    assert.equal(
      readVsCodeCompanionVersion(
        join(extensions, `magiusche.pi-webview-ide-${realVsixVersion}`),
      ),
      realVsixVersion,
    );
    assert.deepEqual(reloads, [realVsixVersion]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid VSIX keeps the previous companion intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-invalid-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const previous = seedVsCodeCompanion(extensions, "0.1.0");
    const invalid = join(root, "invalid.vsix");
    writeFileSync(invalid, "not a zip");
    const notes = await installVsCodeCompanionDirect(invalid, realVsixVersion, false, {
      targets: [directTarget(extensions)],
      writeReload: () => assert.fail("reload must not be requested"),
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.kind, "error");
    assert.equal(existsSync(previous), true);
    assert.equal(readVsCodeCompanionVersion(previous), "0.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct VSIX extraction rejects path traversal", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-traversal-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const previous = seedVsCodeCompanion(extensions, "0.1.0");
    const malicious = join(root, "malicious.vsix");
    writeFileSync(malicious, zipSync({ "../escaped.txt": strToU8("unsafe") }));
    const notes = await installVsCodeCompanionDirect(malicious, realVsixVersion, false, {
      targets: [directTarget(extensions)],
      writeReload: () => assert.fail("reload must not be requested"),
    });
    assert.equal(notes[0]?.kind, "error");
    assert.equal(existsSync(join(root, "escaped.txt")), false);
    assert.equal(readVsCodeCompanionVersion(previous), "0.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forced direct install reinstalls the current version", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-force-"));
  const extensions = join(root, "extensions");
  mkdirSync(extensions);
  try {
    const previous = seedVsCodeCompanion(extensions, realVsixVersion);
    writeFileSync(join(previous, "stale"), "remove");
    const reloads: string[] = [];
    const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, true, {
      targets: [directTarget(extensions)],
      writeReload: (version) => reloads.push(version),
    });
    assert.equal(notes[0]?.kind, "updated");
    assert.equal(notes[0]?.fromVersion, realVsixVersion);
    assert.equal(existsSync(join(previous, "stale")), false);
    assert.deepEqual(reloads, [realVsixVersion]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct VSIX install continues after a destination error", async () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-partial-"));
  const broken = join(root, "not-a-directory");
  const extensions = join(root, "extensions");
  writeFileSync(broken, "file");
  mkdirSync(extensions);
  try {
    const notes = await installVsCodeCompanionDirect(realVsix, realVsixVersion, false, {
      targets: [directTarget(broken, "Broken target"), directTarget(extensions)],
      clearReload: () => {},
    });
    assert.equal(
      notes.some((note) => note.kind === "installed"),
      true,
    );
    assert.equal(
      notes.some((note) => note.kind === "error" && note.label === "Broken target"),
      true,
    );
    assert.equal(
      existsSync(join(extensions, `magiusche.pi-webview-ide-${realVsixVersion}`)),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct uninstall removes every companion copy from every destination", () => {
  const root = mkdtempSync(join(tmpdir(), "piw-vsc-uninstall-"));
  const desktop = join(root, "desktop");
  const server = join(root, "server");
  mkdirSync(desktop);
  mkdirSync(server);
  try {
    const copies = [
      seedVsCodeCompanion(desktop, "0.1.0"),
      seedVsCodeCompanion(desktop, "0.2.0"),
      seedVsCodeCompanion(server, "0.3.0"),
    ];
    const result = uninstallVsCodeCompanionDirect([
      directTarget(desktop, "Desktop"),
      directTarget(server, "Server"),
    ]);
    assert.deepEqual(result, { removed: 3, errors: [] });
    assert.equal(
      copies.some((folder) => existsSync(folder)),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Chrome Web Store installer uses the permanent listing item id", () => {
  assert.equal(CHROME_WEB_STORE_ID, "hcdjfkcgojomhpmcfgipginghhlncamn");
  assert.equal(
    chromeStoreUrl(),
    "https://chromewebstore.google.com/detail/hcdjfkcgojomhpmcfgipginghhlncamn",
  );
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
    { target: "chrome", kind: "action-required", label: "/tmp/chrome" },
  ];
  const en = formatCompanionNotes(notes, "en", "pi-webview: ");
  const it = formatCompanionNotes(notes, "it", "piw: ");
  assert.equal(en[0], "pi-webview: companion installed in VS Code (0.2.1).");
  assert.equal(en[1], "pi-webview: companion updated in VS Code (0.2.0 → 0.2.1).");
  assert.equal(en[2], "pi-webview: companion install failed in VS Code: boom");
  assert.equal(
    en[3],
    "pi-webview: companion installed in Visual Studio (VS 2022, 0.2.1).",
  );
  assert.equal(
    en[5],
    "pi-webview: companion install failed in Visual Studio (VS 2022): bang",
  );
  assert.equal(it[0], "piw: companion VS Code installato (0.2.1).");
  assert.equal(
    it[4],
    "piw: companion Visual Studio aggiornato in VS 2026 (0.2.0 → 0.2.1).",
  );
  assert.equal(
    it[5],
    "piw: installazione companion Visual Studio fallita in VS 2022: bang",
  );
  assert.equal(
    en[6],
    "pi-webview: complete the Chrome companion installation in the opened Web Store page.",
  );
  assert.equal(
    it[6],
    "piw: completa l'installazione del companion Chrome nella pagina Web Store aperta.",
  );
});

test("companionReloadHints: one line per IDE, none for errors only", () => {
  const both: CompanionNote[] = [
    { target: "vscode", kind: "installed", version: "0.2.3" },
    {
      target: "visualstudio",
      kind: "updated",
      version: "0.2.3",
      fromVersion: "0.2.3",
      label: "Visual Studio Community 2026",
    },
  ];
  const en = companionReloadHints(both, "en", "pi-webview: ");
  assert.deepEqual(en, [
    "pi-webview: reload the VS Code window to activate the webview.",
    "pi-webview: reload Visual Studio to activate the webview.",
  ]);
  // multiple VS instances updated → still ONE hint (never per install)
  const multi: CompanionNote[] = [
    {
      target: "visualstudio",
      kind: "updated",
      version: "0.2.3",
      fromVersion: "0.2.2",
      label: "Visual Studio Community 2026",
    },
    {
      target: "visualstudio",
      kind: "updated",
      version: "0.2.3",
      fromVersion: "0.2.2",
      label: "Visual Studio Professional 2022",
    },
  ];
  assert.deepEqual(companionReloadHints(multi, "en", "pi-webview: "), [
    "pi-webview: reload Visual Studio to activate the webview.",
  ]);
  // errors only → no reload hints
  assert.deepEqual(
    companionReloadHints([{ target: "vscode", kind: "error", error: "x" }], "en", "p: "),
    [],
  );
  // it locale
  assert.deepEqual(companionReloadHints(both, "it", "piw: "), [
    "piw: ricarica la finestra di VS Code per attivare la webview.",
    "piw: ricarica Visual Studio per attivare la webview.",
  ]);
});

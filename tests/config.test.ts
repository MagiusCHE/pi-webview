import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { userConfigDir, ConfigStore, DEFAULT_CONFIG } from "../src/bridge/config.ts";

test("userConfigDir: percorsi per i 3 sistemi (D6)", () => {
  const oldHome = process.env.HOME;
  const oldXdg = process.env.XDG_CONFIG_HOME;
  const oldAppData = process.env.APPDATA;
  try {
    process.env.HOME = "/Users/test";
    process.env.XDG_CONFIG_HOME = "/home/test/.config";
    assert.equal(userConfigDir("linux"), "/home/test/.config/pi-webview");
    assert.equal(
      userConfigDir("darwin"),
      posix.join("/Users/test", "Library", "Application Support", "pi-webview"),
    );
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    assert.equal(
      userConfigDir("win32"),
      win32.join("C:\\Users\\test\\AppData\\Roaming", "pi-webview"),
    );
  } finally {
    process.env.HOME = oldHome;
    process.env.XDG_CONFIG_HOME = oldXdg;
    process.env.APPDATA = oldAppData;
  }
});

test("userConfigDir: fallback su linux senza XDG_CONFIG_HOME", () => {
  const oldHome = process.env.HOME;
  const oldXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.HOME = "/home/test";
    delete process.env.XDG_CONFIG_HOME;
    assert.equal(userConfigDir("linux"), "/home/test/.config/pi-webview");
  } finally {
    process.env.HOME = oldHome;
    process.env.XDG_CONFIG_HOME = oldXdg;
  }
});

test("ConfigStore: default, patch e persistenza", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-config-"));
  try {
    const store = new ConfigStore(dir);
    assert.deepEqual(store.get(), DEFAULT_CONFIG);
    store.patch({ theme: "dark" });
    assert.equal(store.get().theme, "dark");

    // ricarica da disco: la patch è persistita
    const reloaded = new ConfigStore(dir);
    assert.equal(reloaded.get().theme, "dark");

    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
    // il default include historyLimit (feature limite cronologia) e
    // statsBarPosition: la patch riparte dal config completo, non solo da theme
    assert.deepEqual(onDisk, {
      theme: "dark",
      historyLimit: 120,
      statsBarPosition: "above",
      timeFormat: "24",
      keepAwakeWhileWorking: false,
      agenticThinking: false,
      allowRemoteNpmUpdates: false,
      dangerouslyAllowAllNpmScripts: false,
      speechToText: {
        mode: "push-to-talk",
        language: "system",
        allowCloudTranscription: false,
        toggleSilenceMs: 1500,
        shortcuts: {
          pushToTalk: "Ctrl+Alt+Space",
          toggleToTalk: "Ctrl+Alt+M",
        },
        inputByRuntime: {},
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore: persiste preferenze UI e sorgenti di stato nascoste", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-config-"));
  try {
    const store = new ConfigStore(dir);
    store.patch({
      statsBarPosition: "topbar",
      statsBarCompact: true,
      agenticThinking: true,
      allowRemoteNpmUpdates: true,
      dangerouslyAllowAllNpmScripts: true,
      browserToolPermissions: {
        global: ["dom"],
        sites: { "https://example.test": ["screenshot", "action"] },
      },
      hiddenStatusKeys: ["mcp", "control"],
      speechToText: {
        mode: "toggle-to-talk",
        language: "it-IT",
        allowCloudTranscription: true,
        toggleSilenceMs: 2200,
        shortcuts: {
          pushToTalk: "Ctrl+Shift+Space",
          toggleToTalk: "Ctrl+Shift+M",
        },
        inputByRuntime: { vscode: "opaque-device" },
      },
    });
    const reloaded = new ConfigStore(dir).get();
    assert.equal(reloaded.statsBarPosition, "topbar");
    assert.equal(reloaded.statsBarCompact, true);
    assert.equal(reloaded.agenticThinking, true);
    assert.equal(reloaded.allowRemoteNpmUpdates, true);
    assert.equal(reloaded.dangerouslyAllowAllNpmScripts, true);
    assert.deepEqual(reloaded.browserToolPermissions, {
      global: ["dom"],
      sites: { "https://example.test": ["screenshot", "action"] },
    });
    assert.deepEqual(reloaded.hiddenStatusKeys, ["mcp", "control"]);
    assert.deepEqual(reloaded.speechToText, {
      mode: "toggle-to-talk",
      language: "it-IT",
      allowCloudTranscription: true,
      toggleSilenceMs: 2200,
      shortcuts: {
        pushToTalk: "Ctrl+Shift+Space",
        toggleToTalk: "Ctrl+Shift+M",
      },
      inputByRuntime: { vscode: "opaque-device" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore: file corrotto → default senza crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-config-"));
  try {
    writeFileSync(join(dir, "config.json"), "{non-json!");
    const store = new ConfigStore(dir);
    assert.deepEqual(store.get(), DEFAULT_CONFIG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore: keepAwakeWhileWorking parte spento e si persiste", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-keepawake-"));
  try {
    assert.equal(new ConfigStore(dir).get().keepAwakeWhileWorking, false);
    assert.equal(
      new ConfigStore(dir).patch({ keepAwakeWhileWorking: true }).keepAwakeWhileWorking,
      true,
    );
    assert.equal(new ConfigStore(dir).get().keepAwakeWhileWorking, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore: timeFormat default 24 ore, normalizzazione e persistenza", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-timeformat-"));
  try {
    assert.equal(new ConfigStore(dir).get().timeFormat, "24");
    assert.equal(new ConfigStore(dir).patch({ timeFormat: "12" }).timeFormat, "12");
    assert.equal(new ConfigStore(dir).get().timeFormat, "12");
    // a hand-edited or legacy value never leaks into the UI
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ timeFormat: "bogus" }) + "\n",
    );
    assert.equal(new ConfigStore(dir).get().timeFormat, "24");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

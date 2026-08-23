import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userConfigDir, ConfigStore, DEFAULT_CONFIG } from "../src/bridge/config.ts";

test("userConfigDir: percorsi per i 3 sistemi (D6)", () => {
  const oldXdg = process.env.XDG_CONFIG_HOME;
  const oldAppData = process.env.APPDATA;
  try {
    process.env.XDG_CONFIG_HOME = "/home/test/.config";
    assert.equal(userConfigDir("linux"), "/home/test/.config/pi-webview");
    assert.equal(
      userConfigDir("darwin"),
      join(process.env.HOME ?? "", "Library", "Application Support", "pi-webview"),
    );
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    assert.equal(
      userConfigDir("win32"),
      join("C:\\Users\\test\\AppData\\Roaming", "pi-webview"),
    );
  } finally {
    process.env.XDG_CONFIG_HOME = oldXdg;
    process.env.APPDATA = oldAppData;
  }
});

test("userConfigDir: fallback su linux senza XDG_CONFIG_HOME", () => {
  const oldXdg = process.env.XDG_CONFIG_HOME;
  try {
    delete process.env.XDG_CONFIG_HOME;
    assert.equal(
      userConfigDir("linux"),
      join(process.env.HOME ?? "", ".config", "pi-webview"),
    );
  } finally {
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
    // il default include historyLimit (feature limite cronologia): la patch
    // riparte dal config completo, non solo da theme
    assert.deepEqual(onDisk, { theme: "dark", historyLimit: 30 });
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

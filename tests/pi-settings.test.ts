// Unit tests for the pi.dev settings facade (plan 0003 V1-bis,
// src/bridge/pi-settings.ts): schema/values of get_settings, the merge
// semantics (global + trusted project override) and the file write
// (validate + read-modify-write preserving unknown fields).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPiSettings,
  setPiSettingFile,
  isFileSetting,
  defaultAgentDir,
  type PiSettingsContext,
} from "../src/bridge/pi-settings.ts";

function tmpAgent(): string {
  return mkdtempSync(join(tmpdir(), "piw-settings-"));
}

function writeSettings(agentDir: string, obj: unknown): void {
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify(obj, null, 2)}\n`,
    "utf8",
  );
}

function writeProjectSettings(workspace: string, obj: unknown): void {
  mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(
    join(workspace, ".pi", "settings.json"),
    `${JSON.stringify(obj, null, 2)}\n`,
    "utf8",
  );
}

test("get_settings: file-backed key carries the merged value (global + trusted project)", () => {
  const agent = tmpAgent();
  try {
    writeSettings(agent, { hideThinkingBlock: true, other: "keep" });
    const ctx: PiSettingsContext = {
      agentDir: agent,
      workspace: "/w",
      workspaceTrusted: true,
    };
    const res = getPiSettings(ctx);
    const htb = res.settings.find((s) => s.key === "hideThinkingBlock");
    assert.ok(htb);
    assert.equal(htb.value, true);
    assert.equal(htb.source, "pi-settings-file");
    assert.equal(htb.propagation, "restart");
    assert.equal(htb.writable, true);
    assert.equal(res.workspace, "/w");
    assert.equal(res.workspaceTrusted, true);
  } finally {
    rmSync(agent, { recursive: true, force: true });
  }
});

test("get_settings: project override wins when trusted", () => {
  const agent = tmpAgent();
  const ws = mkdtempSync(join(tmpdir(), "piw-proj-"));
  try {
    writeSettings(agent, { hideThinkingBlock: false });
    writeProjectSettings(ws, { hideThinkingBlock: true });
    const trusted = getPiSettings({
      agentDir: agent,
      workspace: ws,
      workspaceTrusted: true,
    });
    assert.equal(
      trusted.settings.find((s) => s.key === "hideThinkingBlock")?.value,
      true,
    );
    const untrusted = getPiSettings({
      agentDir: agent,
      workspace: ws,
      workspaceTrusted: false,
    });
    assert.equal(
      untrusted.settings.find((s) => s.key === "hideThinkingBlock")?.value,
      false,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test("get_settings: session keys have no value (webview fills from get_state)", () => {
  const res = getPiSettings({});
  const steering = res.settings.find((s) => s.key === "steeringMode");
  assert.ok(steering);
  assert.equal(steering.source, "pi-rpc");
  assert.equal(steering.value, undefined);
  assert.deepEqual(
    steering.options?.map((o) => o.value),
    ["one-at-a-time", "all"],
  );
  const model = res.settings.find((s) => s.key === "model");
  assert.equal(model?.writable, false);
});

test("set_setting file: validates the value (rejects wrong type)", () => {
  const agent = tmpAgent();
  try {
    const bad = setPiSettingFile("hideThinkingBlock", "yes", { agentDir: agent });
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /expected boolean/);
  } finally {
    rmSync(agent, { recursive: true, force: true });
  }
});

test("set_setting file: read-modify-write preserves unknown fields", () => {
  const agent = tmpAgent();
  try {
    writeSettings(agent, { otherSetting: 42, hideThinkingBlock: false });
    const res = setPiSettingFile("hideThinkingBlock", true, { agentDir: agent });
    assert.equal(res.ok, true);
    const after = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8")) as {
      otherSetting?: number;
      hideThinkingBlock?: boolean;
    };
    assert.equal(after.hideThinkingBlock, true);
    assert.equal(after.otherSetting, 42);
  } finally {
    rmSync(agent, { recursive: true, force: true });
  }
});

test("set_setting file: project override requires trusted workspace", () => {
  const agent = tmpAgent();
  const ws = mkdtempSync(join(tmpdir(), "piw-proj-"));
  try {
    const untrusted = setPiSettingFile("hideThinkingBlock", true, {
      agentDir: agent,
      workspace: ws,
      workspaceTrusted: false,
      scope: "project",
    });
    assert.equal(untrusted.ok, false);
    assert.match(untrusted.error ?? "", /not trusted/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test("set_setting file: scope both defaults to project when trusted", () => {
  const agent = tmpAgent();
  const ws = mkdtempSync(join(tmpdir(), "piw-proj-"));
  try {
    const res = setPiSettingFile("hideThinkingBlock", true, {
      agentDir: agent,
      workspace: ws,
      workspaceTrusted: true,
    });
    assert.equal(res.ok, true);
    // written to the PROJECT file (trusted → override), not the global one
    const proj = JSON.parse(readFileSync(join(ws, ".pi", "settings.json"), "utf8")) as {
      hideThinkingBlock?: boolean;
    };
    assert.equal(proj.hideThinkingBlock, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test("isFileSetting / defaultAgentDir", () => {
  assert.equal(isFileSetting("hideThinkingBlock"), true);
  assert.equal(isFileSetting("steeringMode"), false);
  assert.equal(isFileSetting("nope"), false);
  assert.equal(defaultAgentDir({ PI_AGENT_DIR: "/x/y" }), "/x/y");
  assert.equal(defaultAgentDir({}), join(homedir(), ".pi", "agent"));
});

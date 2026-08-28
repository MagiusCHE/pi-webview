// pi.dev settings facade (plan 0003 V1-bis). Shared by the VS Code host
// (src/adapters/vscode/host.ts) and the standalone bridge (src/bridge/index.ts):
// ONE source of truth for the schema + per-key read/write, same role as
// companions.ts.
//
// pi.dev has no settings RPC and no settings API for extensions (verified),
// so file-backed keys are read/written directly with the SAME semantics as
// pi's SettingsManager: effective value = merge(global, project), the project
// override only applies when the workspace is trusted, writes are
// read-modify-write preserving unknown fields (lock: pi.dev uses a lockfile,
// we approximate with atomic tmp+rename).
//
// For source "pi-rpc" the value is absent from the payload: the webview talks
// to pi directly (rpc channel) and fills the values from get_state; the host
// has no RPC client.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  PiSetting,
  PiSettingOption,
  PiSettingScope,
  PiSettingSource,
  PiSettingsResult,
} from "../ide/protocol.ts";

export interface PiSettingsContext {
  /** current pi workspace (for project-scoped settings) */
  workspace?: string;
  /** true → the workspace is trusted and can carry a project override */
  workspaceTrusted?: boolean;
  /** overrides ~/.pi/agent (tests / PI_AGENT_DIR handled by defaultAgentDir) */
  agentDir?: string;
}

interface PiSettingDef {
  key: string;
  label: string;
  description?: string;
  type: "boolean" | "number" | "enum" | "string";
  options?: PiSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  source: PiSettingSource;
  scope: PiSettingScope;
  writable?: boolean;
  propagation?: "restart" | "none";
}

/** agent dir, like pi.dev: PI_AGENT_DIR env or ~/.pi/agent */
export function defaultAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function globalSettingsPath(ctx: PiSettingsContext): string {
  return join(ctx.agentDir ?? defaultAgentDir(), "settings.json");
}

function projectSettingsPath(ctx: PiSettingsContext): string | null {
  return ctx.workspace ? join(ctx.workspace, ".pi", "settings.json") : null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Definitions table — the ONLY place to add a setting (one row, zero HTML).
// label/description/options are i18n keys resolved by the webview via t().
const DEFS: PiSettingDef[] = [
  {
    key: "hideThinkingBlock",
    label: "piSettingHideThinkingBlock",
    description: "piSettingHideThinkingBlockDesc",
    type: "boolean",
    source: "pi-settings-file",
    scope: "both",
    propagation: "restart",
  },
  {
    key: "model",
    label: "piSettingModel",
    type: "string",
    source: "pi-rpc",
    scope: "session",
    writable: false,
  },
  {
    key: "thinkingLevel",
    label: "piSettingThinkingLevel",
    type: "string",
    source: "pi-rpc",
    scope: "session",
    writable: false,
  },
  {
    key: "steeringMode",
    label: "piSettingSteeringMode",
    type: "enum",
    source: "pi-rpc",
    scope: "session",
    options: [
      { value: "one-at-a-time", label: "piSettingModeOptOneAtATime" },
      { value: "all", label: "piSettingModeOptAll" },
    ],
  },
  {
    key: "followUpMode",
    label: "piSettingFollowUpMode",
    type: "enum",
    source: "pi-rpc",
    scope: "session",
    options: [
      { value: "one-at-a-time", label: "piSettingModeOptOneAtATime" },
      { value: "all", label: "piSettingModeOptAll" },
    ],
  },
  {
    key: "autoCompaction",
    label: "piSettingAutoCompaction",
    type: "boolean",
    source: "pi-rpc",
    scope: "session",
  },
];

/** effective value = merge(global, project): project wins when trusted */
function readSettingValue(ctx: PiSettingsContext, def: PiSettingDef): unknown {
  const project = ctx.workspaceTrusted ? readJson(projectSettingsPath(ctx) ?? "") : null;
  if (project && project[def.key] !== undefined) return project[def.key];
  const global = readJson(globalSettingsPath(ctx));
  if (global && global[def.key] !== undefined) return global[def.key];
  return undefined;
}

function validate(
  def: PiSettingDef,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true }
        : { ok: false, error: `expected boolean, got ${typeof value}` };
    case "number":
      if (typeof value !== "number") {
        return { ok: false, error: `expected number, got ${typeof value}` };
      }
      if (def.min !== undefined && value < def.min) {
        return { ok: false, error: `below min ${def.min}` };
      }
      if (def.max !== undefined && value > def.max) {
        return { ok: false, error: `above max ${def.max}` };
      }
      return { ok: true };
    case "enum":
      return def.options?.some((o) => o.value === value)
        ? { ok: true }
        : { ok: false, error: `invalid enum value: ${String(value)}` };
    case "string":
      return typeof value === "string"
        ? { ok: true }
        : { ok: false, error: `expected string, got ${typeof value}` };
  }
}

/** scope rule (plan 0003): "both" → project if trusted (override), else global */
function defaultWriteScope(
  def: PiSettingDef,
  ctx: PiSettingsContext,
): "global" | "project" {
  if (def.scope === "global") return "global";
  if (def.scope === "project") return "project";
  return ctx.workspaceTrusted && ctx.workspace ? "project" : "global";
}

function atomicWriteJson(path: string, obj: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function buildSetting(def: PiSettingDef, ctx: PiSettingsContext): PiSetting {
  const setting: PiSetting = {
    key: def.key,
    label: def.label,
    type: def.type,
    writable: def.writable ?? true,
    source: def.source,
    scope: def.scope,
  };
  if (def.description) setting.description = def.description;
  if (def.options) setting.options = def.options;
  if (def.min !== undefined) setting.min = def.min;
  if (def.max !== undefined) setting.max = def.max;
  if (def.step !== undefined) setting.step = def.step;
  if (def.propagation) setting.propagation = def.propagation;
  if (def.source === "pi-settings-file") {
    setting.value = readSettingValue(ctx, def);
  }
  return setting;
}

/** get_settings implementation: schema + current values (file-backed keys). */
export function getPiSettings(ctx: PiSettingsContext, key?: string): PiSettingsResult {
  const settings = DEFS.filter((d) => !key || d.key === key).map((d) =>
    buildSetting(d, ctx),
  );
  return {
    settings,
    workspace: ctx.workspace,
    workspaceTrusted: ctx.workspaceTrusted,
  };
}

/** true when the key is written by the host (file), not by the webview (RPC) */
export function isFileSetting(key: string): boolean {
  return DEFS.some((d) => d.key === key && d.source === "pi-settings-file");
}

/**
 * set_setting implementation for file-backed keys: validate + read-modify-write
 * preserving unknown fields (same merge semantics as pi.dev's
 * persistScopedSettings). Returns { ok: false, error } on invalid value /
 * untrusted project / missing workspace; { ok: true } once the file is written
 * (the caller then restarts pi — propagation "restart").
 */
export function setPiSettingFile(
  key: string,
  value: unknown,
  ctx: PiSettingsContext & { scope?: "global" | "project" },
): { ok: boolean; error?: string } {
  const def = DEFS.find((d) => d.key === key);
  if (!def || def.source !== "pi-settings-file") {
    return { ok: false, error: `unknown file-backed setting: ${key}` };
  }
  const v = validate(def, value);
  if (!v.ok) return { ok: false, error: v.error };

  const scope = ctx.scope ?? defaultWriteScope(def, ctx);
  if (scope === "project") {
    if (!ctx.workspace) {
      return { ok: false, error: "no workspace: cannot write a project override" };
    }
    if (!ctx.workspaceTrusted) {
      return {
        ok: false,
        error: "workspace not trusted: project overrides are disabled (like pi.dev)",
      };
    }
  }
  const path = scope === "project" ? projectSettingsPath(ctx) : globalSettingsPath(ctx);
  if (!path) return { ok: false, error: "no target file" };

  const current = readJson(path) ?? {};
  atomicWriteJson(path, { ...current, [key]: value });
  return { ok: true };
}

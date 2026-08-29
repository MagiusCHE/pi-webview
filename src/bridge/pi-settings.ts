// pi.dev settings facade (plan 0003 V1-bis). Shared by the VS Code host
// (src/adapters/vscode/host.ts) and the standalone bridge (src/bridge/index.ts):
// ONE source of truth for the schema + per-key read/write, same role as
// companions.ts.
//
// pi.dev has no settings RPC and no settings API for extensions (verified),
// so file-backed keys are read/written directly with the SAME semantics as
// pi's SettingsManager: effective value = merge(global, project), the project
// override only applies when the workspace is trusted, writes are
// read-modify-write preserving unknown fields, protected by the same
// `<settings path>.lock` directory convention used by proper-lockfile in pi.
//
// For source "pi-rpc" the value is absent from the payload: the webview talks
// to pi directly (rpc channel) and fills the values from get_state; the host
// has no RPC client.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type {
  PiModelSettingValue,
  PiSetting,
  PiSettingChange,
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
  group?: string;
  type: "boolean" | "number" | "enum" | "string" | "model";
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
    key: "defaultModel",
    label: "piSettingDefaultModel",
    description: "piSettingDefaultModelDesc",
    group: "piSettingsGroupNewSessions",
    type: "model",
    source: "pi-settings-file",
    scope: "both",
    propagation: "restart",
  },
  {
    key: "defaultThinkingLevel",
    label: "piSettingDefaultThinkingLevel",
    description: "piSettingDefaultThinkingLevelDesc",
    group: "piSettingsGroupNewSessions",
    type: "enum",
    source: "pi-settings-file",
    scope: "both",
    propagation: "restart",
    options: [
      { value: "off", label: "levelOff" },
      { value: "minimal", label: "levelMinimal" },
      { value: "low", label: "levelLow" },
      { value: "medium", label: "levelMedium" },
      { value: "high", label: "levelHigh" },
      { value: "xhigh", label: "levelXHigh" },
      { value: "max", label: "levelMax" },
    ],
  },
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
  const global = readJson(globalSettingsPath(ctx));
  if (def.type === "model") {
    const provider = project?.defaultProvider ?? global?.defaultProvider;
    const id = project?.defaultModel ?? global?.defaultModel;
    if (typeof provider !== "string" || typeof id !== "string") return undefined;
    return { provider, id } satisfies PiModelSettingValue;
  }
  if (project && project[def.key] !== undefined) return project[def.key];
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
    case "model": {
      const model = value as Partial<PiModelSettingValue> | null;
      return model &&
        typeof model.provider === "string" &&
        model.provider.length > 0 &&
        typeof model.id === "string" &&
        model.id.length > 0
        ? { ok: true }
        : { ok: false, error: "expected model { provider, id }" };
    }
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

function withSettingsLock<T>(path: string, fn: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EEXIST" || attempt === 9) throw error;
      const until = Date.now() + 20;
      while (Date.now() < until) {
        // Synchronous callers match pi's own short lock retry.
      }
    }
  }
  if (!acquired) throw new Error("failed to acquire settings lock");
  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function atomicWriteJson(path: string, obj: Record<string, unknown>): void {
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
  if (def.group) setting.group = def.group;
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

function settingPatch(def: PiSettingDef, value: unknown): Record<string, unknown> {
  if (def.type === "model") {
    const model = value as PiModelSettingValue;
    return { defaultProvider: model.provider, defaultModel: model.id };
  }
  return { [def.key]: value };
}

/**
 * Batch set_settings implementation for file-backed keys. Every change is
 * validated before writing; changes targeting the same file are merged into
 * one atomic read-modify-write, so model + thinking defaults require one host
 * request and one pi restart.
 */
export function setPiSettingsFile(
  changes: PiSettingChange[],
  ctx: PiSettingsContext,
): { ok: boolean; error?: string } {
  const writes = new Map<string, Record<string, unknown>>();
  for (const change of changes) {
    const def = DEFS.find((d) => d.key === change.key);
    if (!def || def.source !== "pi-settings-file") {
      return { ok: false, error: `unknown file-backed setting: ${change.key}` };
    }
    const valid = validate(def, change.value);
    if (!valid.ok) return { ok: false, error: `${change.key}: ${valid.error}` };

    const scope = change.scope ?? defaultWriteScope(def, ctx);
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
    writes.set(path, { ...(writes.get(path) ?? {}), ...settingPatch(def, change.value) });
  }

  try {
    for (const [path, patch] of writes) {
      withSettingsLock(path, () => {
        const current = readJson(path) ?? {};
        atomicWriteJson(path, { ...current, ...patch });
      });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Backward-compatible singular facade, implemented through the batch writer. */
export function setPiSettingFile(
  key: string,
  value: unknown,
  ctx: PiSettingsContext & { scope?: "global" | "project" },
): { ok: boolean; error?: string } {
  return setPiSettingsFile(
    [{ key, value, ...(ctx.scope ? { scope: ctx.scope } : {}) }],
    ctx,
  );
}

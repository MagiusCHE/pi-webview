// Project trust, mirroring pi.dev:
// - ~/.pi/agent/trust.json → map path → bool (decision saved by the TUI prompt)
// - defaultProjectTrust in ~/.pi/agent/settings.json → "ask" | "always" | "never"
//
// pi NEVER prompts in RPC mode (the mode pi-webview uses): with no saved
// decision and default "ask" the protected project resources are ignored for
// that run. The effective status is therefore a boolean — trusted or
// untrusted — and there is no third "ask" level to display.
//
// A decision is only APPLIED by a pi restart: the running process keeps the
// resources it loaded at launch. The "this session only" options of the TUI
// prompt are not persisted at all: they run pi with `--approve` /
// `--no-approve` for that process only.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type {
  TrustOption,
  TrustOptionId,
  TrustResult,
  TrustStatus,
} from "../ide/protocol.ts";

export type { TrustOption, TrustOptionId, TrustResult, TrustStatus };

/** One entry written to trust.json: `null` removes the entry (like pi's
 *  "trust parent folder", which clears the folder-specific decision). */
interface TrustUpdate {
  path: string;
  decision: boolean | null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function trustDir(): string {
  return join(homedir(), ".pi", "agent");
}

// the decision applies to the folder or a parent (like pi)
function findTrust(
  trustFile: Record<string, unknown>,
  workspace: string,
): boolean | undefined {
  let current = workspace;
  for (;;) {
    if (current in trustFile) return trustFile[current] === true;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** the folder the "trust parent folder" option saves its decision to */
export function trustParentPath(workspace: string): string | undefined {
  const parent = dirname(workspace);
  return parent === workspace ? undefined : parent;
}

/** Status pi applies to the protected resources of a workspace: the saved
 *  decision, then defaultProjectTrust; "ask" (no decision) → untrusted. */
export function getTrust(workspace: string, dir: string = trustDir()): TrustResult {
  const trustFile = readJson(join(dir, "trust.json"));
  const settings = readJson(join(dir, "settings.json"));
  const defaultTrust = settings?.defaultProjectTrust;

  const decision = trustFile ? findTrust(trustFile, workspace) : undefined;
  const status: TrustStatus =
    decision !== undefined
      ? decision
        ? "trusted"
        : "untrusted"
      : defaultTrust === "always"
        ? "trusted"
        : "untrusted";
  return {
    status,
    workspace,
    parentPath: trustParentPath(workspace),
    options: trustOptions(workspace),
  };
}

/** Options of the pi trust prompt (same list and order as pi core). */
export function trustOptions(workspace: string): TrustOption[] {
  const options: TrustOption[] = [{ id: "trust" }];
  if (trustParentPath(workspace) !== undefined) options.push({ id: "trust-parent" });
  options.push(
    { id: "trust-session", sessionOverride: true },
    { id: "untrust" },
    { id: "untrust-session", sessionOverride: false },
  );
  return options;
}

function updatesFor(workspace: string, id: TrustOptionId): TrustUpdate[] {
  switch (id) {
    case "trust":
      return [{ path: workspace, decision: true }];
    case "trust-parent": {
      const parent = trustParentPath(workspace);
      return parent
        ? [
            { path: parent, decision: true },
            { path: workspace, decision: null },
          ]
        : [];
    }
    case "untrust":
      return [{ path: workspace, decision: false }];
    default:
      // session-only options persist nothing
      return [];
  }
}

function writeTrustUpdates(updates: TrustUpdate[], dir: string): void {
  if (updates.length === 0) return;
  const path = join(dir, "trust.json");
  const trustFile = readJson(path) ?? {};
  for (const { path: entry, decision } of updates) {
    if (decision === null) delete trustFile[entry];
    else trustFile[entry] = decision;
  }
  // A silent failure would leave the UI showing a decision that was never
  // saved: the error must reach the caller (the webview shows it in the chat).
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(trustFile, null, 2) + "\n");
}

export interface TrustApplyResult {
  /** status pi applies after the next restart */
  status: TrustStatus;
  /** run-only override for the next launch (absent for persisted options) */
  sessionOverride?: boolean;
}

/** Applies one option of the prompt: persisted ones write trust.json, the
 *  session-only ones only report the per-run override to use at launch. */
export function applyTrustOption(
  workspace: string,
  id: TrustOptionId,
  dir: string = trustDir(),
): TrustApplyResult {
  const option = trustOptions(workspace).find((o) => o.id === id);
  if (!option) throw new Error(`unknown trust option: ${id}`);
  if (option.sessionOverride === undefined) {
    writeTrustUpdates(updatesFor(workspace, id), dir);
    return { status: getTrust(workspace, dir).status };
  }
  return {
    status: option.sessionOverride ? "trusted" : "untrusted",
    sessionOverride: option.sessionOverride,
  };
}

/** Run-only pi flags of the session-only options: pi accepts them per run and
 *  never persists them (trust.json is untouched). */
export function trustOverrideArgs(override?: boolean): string[] {
  if (override === undefined) return [];
  return [override ? "--approve" : "--no-approve"];
}

/**
 * Per-process trust state of a host.
 *
 * The running pi process keeps the decision it was launched with, so a change
 * is only applied by a restart: `apply()` writes the decision (or arms the
 * run-only override) and reports `pendingRestart`, while `status()` keeps
 * reporting what the running process actually uses. `launchArgs()` +
 * `onLaunched()` implement the handoff of the session-only override: it is
 * consumed by the NEXT launch and forgotten by the one after (a later restart
 * ends the "this session only" choice, exactly like pi).
 */
export class TrustRuntime {
  private workspacePath: string;
  private dir: string;
  private pendingOverride: boolean | undefined;
  private appliedOverride: boolean | undefined;
  private launchStatus: TrustStatus;
  private restartPending = false;

  constructor(workspace: string, dir: string = trustDir()) {
    this.workspacePath = workspace;
    this.dir = dir;
    this.launchStatus = getTrust(workspace, dir).status;
  }

  setWorkspace(workspace: string): void {
    this.workspacePath = workspace;
    this.launchStatus = getTrust(workspace, this.dir).status;
  }

  /** args for the pi process about to be launched (empty when nothing is pending) */
  launchArgs(): string[] {
    return trustOverrideArgs(this.pendingOverride);
  }

  /** called right after pi was (re)launched: the pending change is now live */
  onLaunched(): void {
    const override = this.pendingOverride;
    this.launchStatus =
      override === undefined
        ? getTrust(this.workspacePath, this.dir).status
        : override
          ? "trusted"
          : "untrusted";
    this.appliedOverride = override;
    this.pendingOverride = undefined;
    this.restartPending = false;
  }

  /** status the running pi process was launched with */
  status(): TrustStatus {
    return this.launchStatus;
  }

  /** whether the running process loads the protected project resources */
  isTrusted(): boolean {
    return this.launchStatus === "trusted";
  }

  result(): TrustResult {
    return {
      ...getTrust(this.workspacePath, this.dir),
      status: this.launchStatus,
      pendingRestart: this.restartPending,
      sessionOnly: this.appliedOverride !== undefined,
    };
  }

  /** Applies one option of the prompt. `result().pendingRestart` tells whether
   *  a pi restart is required for it to take effect. */
  apply(id: TrustOptionId): TrustResult {
    const before = this.launchStatus;
    const applied = applyTrustOption(this.workspacePath, id, this.dir);
    this.pendingOverride = applied.sessionOverride;
    this.restartPending = applied.status !== before;
    if (!this.restartPending) this.pendingOverride = undefined;
    return this.result();
  }
}

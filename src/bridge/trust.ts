// Livello di trust del progetto corrente, come pi.dev:
// - ~/.pi/agent/trust.json → map percorso → bool (decisione salvata con /trust)
// - defaultProjectTrust in ~/.pi/agent/settings.json → "ask" | "always" | "never"
// (docs/settings.md di pi, sezione "Project Trust").

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import type { TrustStatus, TrustResult } from "../ide/protocol.ts";

export type { TrustStatus, TrustResult };

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

// la decisione vale per la cartella o un parent (come pi)
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

export function getTrust(workspace: string, dir: string = trustDir()): TrustResult {
  const trustFile = readJson(join(dir, "trust.json"));
  const settings = readJson(join(dir, "settings.json"));
  const defaultTrust = settings?.defaultProjectTrust;

  const decision = trustFile ? findTrust(trustFile, workspace) : undefined;
  let status: TrustStatus;
  if (decision !== undefined) {
    status = decision ? "trusted" : "untrusted";
  } else if (defaultTrust === "always") {
    status = "trusted";
  } else if (defaultTrust === "never") {
    status = "untrusted";
  } else {
    status = "ask"; // default ("ask")
  }
  return { status, workspace };
}

// Scrive una decisione di trust per il workspace (come /trust di pi):
// trusted → true, untrusted → false, ask → rimuove la voce (fallback al default).
export function setTrust(
  workspace: string,
  status: TrustStatus,
  dir: string = trustDir(),
): TrustResult {
  const path = join(dir, "trust.json");
  const trustFile = readJson(path) ?? {};
  if (status === "ask") {
    delete trustFile[workspace];
  } else {
    trustFile[workspace] = status === "trusted";
  }
  try {
    writeFileSync(path, JSON.stringify(trustFile, null, 2) + "\n");
  } catch {
    // directory non scrivibile: riporta comunque lo stato richiesto
  }
  return getTrust(workspace, dir);
}

// Standalone bridge lock (plan 0005): guarantees ONE bridge listening per
// user. The file lives in ~/.pi/pi-webview/bridge.json and is validated at
// every `piw` startup (live pid + health check with the token) — a lock left
// over by a crash is harmless and gets overwritten.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export interface BridgeLock {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export function lockPath(): string {
  return join(homedir(), ".pi", "pi-webview", "bridge.json");
}

export function readLock(): BridgeLock | null {
  try {
    const raw = readFileSync(lockPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<BridgeLock>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.port === "number" &&
      typeof parsed.token === "string"
    ) {
      return parsed as BridgeLock;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLock(info: BridgeLock): void {
  mkdirSync(dirname(lockPath()), { recursive: true });
  writeFileSync(lockPath(), JSON.stringify(info, null, 2) + "\n");
}

export function clearLock(): void {
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    // irrelevant: the lock will be validated anyway on the next start
  }
}

/** true if the process with that pid is alive (or unknown). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** bridge health check: answers 200 only with the right token. */
export async function healthCheck(
  port: number,
  token: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

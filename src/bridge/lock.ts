// Lock del bridge standalone (piano 0005): garantisce UN solo bridge in
// ascolto per utente. Il file vive in ~/.pi/pi-webview/bridge.json e viene
// validato a ogni avvio di `piw` (pid vivo + health check col token) — un
// lock "appeso" da un crash è innocuo e viene sovrascritto.

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
    // irrilevante: il lock verrà comunque validato al prossimo avvio
  }
}

/** true se il processo con quel pid è vivo (o non si può sapere). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** health check del bridge: risponde 200 solo con il token giusto. */
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

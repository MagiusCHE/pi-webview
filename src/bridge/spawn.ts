// Resolution of the `pi` binary cross-platform (concept 0002 D6):
// on Windows the npm shim is `pi.cmd`, elsewhere `pi`.

import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export function piBinName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "pi.cmd" : "pi";
}

export function findOnPath(
  bin: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathEnv = process.env.PATH ?? "";
  const sep = platform === "win32" ? ";" : ":";
  const exts = platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // prossimo candidato
      }
    }
  }
  return null;
}

export interface PiResolution {
  command: string;
  found: boolean;
  path: string | null;
}

export function resolvePi(platform: NodeJS.Platform = process.platform): PiResolution {
  const bin = piBinName(platform);
  const path = findOnPath(bin, platform);
  return { command: bin, found: path !== null, path };
}

// pi on Windows requires a bash shell (Git Bash / Cygwin / MSYS2 / WSL):
// docs/windows.md of pi. Returns a warning if missing.
export function checkBashOnWindows(
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32") return null;
  const found = findOnPath("bash", platform);
  if (found) return null;
  return "pi su Windows richiede una bash shell (Git Bash, Cygwin, MSYS2 o WSL) in PATH";
}

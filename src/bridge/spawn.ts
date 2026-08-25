// Resolution of the `pi` binary cross-platform (concept 0002 D6):
// on Windows the npm shim is `pi.cmd`, elsewhere `pi`.

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
        // next candidate
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

// Fallback when the extension host PATH misses the shell-only dirs (VS Code
// launched from a desktop icon does not inherit the shell PATH: ~/.local/bin,
// npm global bin, pnpm bin, homebrew…). Checks the well-known locations and
// returns the first executable, or null. The resolved absolute path is then
// spawned directly (PiProcess spawns the command as-is).
export function findPiFallback(
  platform: NodeJS.Platform = process.platform,
): PiResolution | null {
  const home = homedir();
  const candidates =
    platform === "win32"
      ? process.env.APPDATA
        ? [join(process.env.APPDATA, "npm", piBinName(platform))]
        : []
      : [
          join(home, ".local", "bin", piBinName(platform)),
          join(home, ".npm-global", "bin", piBinName(platform)),
          join(home, ".npm-packages", "bin", piBinName(platform)),
          join(home, ".node", "bin", piBinName(platform)),
          join(home, ".local", "share", "pnpm", piBinName(platform)),
          join(home, ".bun", "bin", piBinName(platform)),
          join(home, ".volta", "bin", piBinName(platform)),
          join(home, ".cargo", "bin", piBinName(platform)),
          "/usr/local/bin/" + piBinName(platform),
          "/opt/homebrew/bin/" + piBinName(platform),
        ];
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK);
      return { command: p, found: true, path: p };
    } catch {
      // not there / not executable: next candidate
    }
  }
  return null;
}

// Last resort: ask the user's login shell where `pi` is. The extension host
// PATH can miss ANY shell-only location (nvm, bun, volta, custom npm prefix…)
// and no fixed-dir list can cover them all. Running the login shell
// (`bash -lc 'command -v pi'`) reproduces exactly what the user's terminal
// sees. Tries $SHELL, then bash, zsh, sh. Cached: the probe is expensive
// (login shell) and runs at most once per host process.
let shellProbePromise: Promise<PiResolution | null> | null = null;

export function findPiViaShell(): Promise<PiResolution | null> {
  if (!shellProbePromise) shellProbePromise = probeShell();
  return shellProbePromise;
}

async function probeShell(): Promise<PiResolution | null> {
  if (process.platform === "win32") return null; // Windows: use the APPDATA fallback
  const shells = [
    ...new Set([process.env.SHELL, "bash", "zsh", "sh"].filter((s): s is string => !!s)),
  ];
  for (const shell of shells) {
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", "command -v pi"], {
        timeout: 6000,
      });
      const p = stdout.trim().split(/\r?\n/)[0] ?? "";
      if (p) {
        try {
          accessSync(p, constants.X_OK);
          return { command: p, found: true, path: p };
        } catch {
          // reported but not executable: try the next shell
        }
      }
    } catch {
      // shell missing / command failed: next shell
    }
  }
  return null;
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

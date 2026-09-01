import { statSync } from "node:fs";
import { homedir } from "node:os";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Returns the shell working directory from which piw was invoked. If the
 * directory was deleted or cannot be read, the user's home is the safe
 * fallback instead of the package installation directory.
 */
export function resolveLaunchCwd(
  readCwd: () => string = () => process.cwd(),
  home: string = homedir(),
): string {
  try {
    const cwd = readCwd();
    if (cwd && isDirectory(cwd)) return cwd;
  } catch {
    // The launch directory may have been removed after the shell entered it.
  }
  return home;
}

export function normalizeLaunchCwd(candidate: unknown, home: string = homedir()): string {
  return typeof candidate === "string" && candidate && isDirectory(candidate)
    ? candidate
    : home;
}

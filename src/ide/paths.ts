// Windows-aware path equality shared by the web UI, the bridge and the IDE
// adapters. pi normalizes session cwd headers on Windows (drive letter
// uppercase, backslash separators — utils/paths.js of pi), while IDE/bridge
// workspace paths keep the on-disk casing: comparing raw strings would
// wrongly treat the same folder as "another folder" (spurious fork prompt,
// wrong in-workspace highlight). On non-Windows paths the comparison stays
// exact (case-sensitive). Mirror of sameWorkspace in
// src/bridge/sessions.ts / PiWebview.Vs.Core.Sessions.SessionStore.

export function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.includes("\\");
}

export function normalizePathForMatch(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/[\\]+$/, "")
    .toLowerCase();
}

export function samePath(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  if (left === right) return true;
  if (isWindowsPath(left) && isWindowsPath(right)) {
    return normalizePathForMatch(left) === normalizePathForMatch(right);
  }
  return false;
}

// Opens a tool-produced file through the native file manager. Standalone uses
// reveal/select instead of launching the file itself, so clicking a model-made
// path cannot accidentally execute a binary.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface FileManagerCommand {
  command: string;
  args: string[];
}

function usesWindowsPaths(value: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(value);
}

export function resolveOpenFilePath(filePath: string, workspace: string): string {
  if (posix.isAbsolute(filePath) || win32.isAbsolute(filePath)) return filePath;
  const pathApi = usesWindowsPaths(workspace) ? win32 : posix;
  return pathApi.resolve(workspace, filePath);
}

export function fileManagerCommand(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): FileManagerCommand {
  if (platform === "darwin") return { command: "open", args: ["-R", filePath] };
  if (platform === "win32") {
    return { command: "explorer.exe", args: [`/select,${filePath}`] };
  }
  return { command: "xdg-open", args: [posix.dirname(filePath)] };
}

export function revealFileInSystemManager(
  filePath: string,
  workspace: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const resolved = resolveOpenFilePath(filePath, workspace);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error("path is not a file");
  const launch = fileManagerCommand(resolved, platform);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise(resolved);
    });
  });
}

// Opens a tool-produced file through the native file manager. Standalone uses
// reveal/select instead of launching the file itself, so clicking a model-made
// path cannot accidentally execute a binary.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface FileManagerCommand {
  command: string;
  args: string[];
}

export function resolveOpenFilePath(filePath: string, workspace: string): string {
  return isAbsolute(filePath) ? filePath : resolve(workspace, filePath);
}

export function fileManagerCommand(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): FileManagerCommand {
  if (platform === "darwin") return { command: "open", args: ["-R", filePath] };
  if (platform === "win32") {
    return { command: "explorer.exe", args: [`/select,${filePath}`] };
  }
  return { command: "xdg-open", args: [dirname(filePath)] };
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

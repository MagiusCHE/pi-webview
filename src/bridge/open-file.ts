// Tool-produced attachment buttons reveal files. Chat links use a separate,
// explicit action to open local documents and folders.

import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, extname, relative, resolve, sep, posix, win32 } from "node:path";
import { isLocalLinkPath } from "../ide/local-link.ts";

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

export interface LocalLinkTarget {
  path: string;
  directory: boolean;
  executable: boolean;
}

export async function inspectLocalLink(
  path: string,
  workspace: string,
): Promise<LocalLinkTarget> {
  if (
    !isLocalLinkPath(path) ||
    (process.platform !== "win32" && usesWindowsPaths(path))
  ) {
    throw new Error("invalid local path");
  }
  const resolved = /^~[/\\]/.test(path)
    ? resolve(homedir(), path.slice(2).replace(/^[/\\]+/, ""))
    : resolve(workspace, path);
  // Check both paths: a directory or document link can point to a different type of target.
  if (!isLocalLinkPath(resolved)) throw new Error("invalid local path");
  const canonical = await realpath(resolved);
  if (!isLocalLinkPath(canonical)) throw new Error("invalid local path");
  const info = await stat(canonical);
  if (!info.isFile() && !info.isDirectory())
    throw new Error("not a regular file or directory");
  return {
    path: canonical,
    directory: info.isDirectory(),
    executable: process.platform !== "win32" && (info.mode & 0o111) !== 0,
  };
}

export async function pathInWorkspace(
  path: string,
  workspace: string,
): Promise<string | undefined> {
  try {
    const fromRoot = relative(await realpath(workspace), path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
      return;
    // Keep the IDE's workspace path even when the root was opened through a symlink.
    return resolve(workspace, fromRoot);
  } catch {
    return undefined;
  }
}

// Shell associations can run code (e.g. .exe, .desktop, .lnk or scripts).
// Only hand known document/media types and folders to native openers.
const DOCUMENT_EXTENSIONS = new Set(
  (
    "txt md log csv tsv json xml yaml yml toml ini rtf pdf doc docx odt xls xlsx ods ppt pptx odp " +
    "png jpg jpeg gif webp avif heic heif bmp ico tif tiff svg psd xcf " +
    "mp3 wav flac ogg opus m4a aac mp4 m4v mov mkv avi webm " +
    "zip tar gz bz2 xz 7z rar epub html htm"
  ).split(" "),
);

export function canOpenLocalLinkNatively(target: LocalLinkTarget): boolean {
  return (
    target.directory ||
    (!target.executable &&
      DOCUMENT_EXTENSIONS.has(extname(target.path).slice(1).toLowerCase()))
  );
}

export function nativeOpenCommand(
  target: LocalLinkTarget,
  platform: NodeJS.Platform = process.platform,
): FileManagerCommand & { env?: NodeJS.ProcessEnv } {
  if (platform === "win32") {
    return {
      command: win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Invoke-Item -LiteralPath $env:PIW_LOCAL_LINK_PATH -ErrorAction Stop",
      ],
      env: { ...process.env, PIW_LOCAL_LINK_PATH: target.path },
    };
  }
  if (platform === "darwin") {
    // Reveal bundles instead of asking Finder to open them as applications.
    const bundle =
      /\.(app|bundle|plugin|kext|prefpane|workflow|action|service|saver|wdgt|qlgenerator)$/i;
    const args = !target.directory
      ? [target.path]
      : bundle.test(target.path)
        ? ["-R", target.path]
        : ["-a", "Finder", target.path];
    return { command: "open", args };
  }
  return { command: "xdg-open", args: [target.path] };
}

export async function openLocalLinkNatively(target: LocalLinkTarget): Promise<void> {
  if (!canOpenLocalLinkNatively(target)) throw new Error("nativeLinkBlocked");
  const { command, args, env } = nativeOpenCommand(target);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    // Some openers stay running for the lifetime of the app. Surface quick
    // launch failures without waiting for the user to close the app.
    const timer = setTimeout(resolvePromise, 1500);
    child.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error("native opener failed"));
    });
  });
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

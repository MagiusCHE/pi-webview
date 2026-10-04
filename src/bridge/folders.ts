import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DirectoryListing } from "../ide/protocol.ts";

// Resolve paths on the bridge's OS, including relative paths in its active workspace.
// Reading the directory also rejects missing paths, files and inaccessible folders.
export function listDirectory(folder: string, workspace: string): DirectoryListing {
  if (!folder.trim()) throw new Error("folder path is required");
  const path = resolve(workspace, folder);
  const dirs = readdirSync(path, { withFileTypes: true })
    .filter((dir) => dir.isDirectory() && !dir.name.startsWith("."))
    .map((dir) => ({ name: dir.name, path: join(path, dir.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, dirs };
}

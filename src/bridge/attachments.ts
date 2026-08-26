// Attachments pasted in the chat: save to disk (temp) and path checks.
// Files pasted from the browser have no real path → saved in a temp folder;
// for images/videos non-vision models receive the path.

import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";

export function attachmentsDir(): string {
  return join(tmpdir(), "pi-webview-attachments");
}

export function saveAttachment(
  name: string,
  mimeType: string,
  dataBase64: string,
  dir: string = attachmentsDir(),
): { path: string } {
  const safe = basename(name).replace(/[^\w.\- ]+/g, "_") || "allegato";
  const file = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}`;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, Buffer.from(dataBase64, "base64"));
  return { path, ...(mimeType ? { mimeType } : {}) };
}

export function pathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".log": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip",
};

/** MIME type guessed from the extension (drag & drop has no browser type). */
export function mimeFromPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// small images are returned inline (base64) so the chat keeps the preview and
// vision models get them as data URIs, exactly like a paste; larger files
// travel as [attachment: path] mentions only
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

/**
 * Attach a file by absolute path (IDE-internal drag & drop, e.g. VS Code
 * file explorer → `vscode-file://` URIs). Copies it into the attachments dir
 * and returns name/mime; base64 only for small images.
 */
export function attachFromPath(
  path: string,
  dir: string = attachmentsDir(),
): { path: string; name: string; mimeType: string; dataBase64?: string } {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`file not found: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`not a file: ${path}`);
  const name = basename(path);
  const safe = name.replace(/[^\w.\- ]+/g, "_") || "allegato";
  const file = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}`;
  mkdirSync(dir, { recursive: true });
  const out = join(dir, file);
  copyFileSync(path, out);
  const mimeType = mimeFromPath(path);
  const res: { path: string; name: string; mimeType: string; dataBase64?: string } = {
    path: out,
    name,
    mimeType,
  };
  if (mimeType.startsWith("image/") && stat.size <= MAX_IMAGE_BASE64_BYTES) {
    res.dataBase64 = readFileSync(out).toString("base64");
  }
  return res;
}

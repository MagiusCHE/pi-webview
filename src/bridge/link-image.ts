import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { linkImageMime, matchesImageHeader, type LinkImage } from "../ide/link-image.ts";
import { inspectLocalLink } from "./open-file.ts";

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

export async function readLinkImage(
  path: string,
  workspace: string,
): Promise<LinkImage | null> {
  try {
    const mimeType = linkImageMime(path);
    if (!mimeType) return null;
    const target = await inspectLocalLink(path, workspace);
    if (target.directory || linkImageMime(target.path) !== mimeType) return null;
    const file = await open(
      target.path,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const info = await file.stat();
      const size = info.size;
      if (!info.isFile() || size === 0 || size > MAX_PREVIEW_BYTES) return null;
      const bytes = Buffer.alloc(size);
      const prefix = Math.min(size, 12);
      const { bytesRead } = await file.read(bytes, 0, prefix, 0);
      if (
        bytesRead !== prefix ||
        !matchesImageHeader(mimeType, bytes.subarray(0, prefix))
      )
        return null;
      for (let read = prefix; read < size;) {
        const chunk = await file.read(bytes, read, size - read, read);
        if (!chunk.bytesRead) return null;
        read += chunk.bytesRead;
      }
      return { mimeType, dataBase64: bytes.toString("base64") };
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

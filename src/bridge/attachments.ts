// Allegati incollati nella chat: salvataggio su disco (temp) e check dei path.
// I file incollati dal browser non hanno un path reale → si salvano in una
// cartella temporanea; per immagini/video i modelli non-vision ricevono il path.

import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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

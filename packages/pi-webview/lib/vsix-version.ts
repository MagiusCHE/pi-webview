// Legge la versione del companion direttamente dal vsix (fonte di verità),
// senza dipendenze: il vsix è uno zip e la versione sta in
// `extension.vsixmanifest` come `Version="x.y.z"`.
// Usa solo node:fs + node:zlib (inflateRawSync per il metodo deflate).

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Ritorna la versione semver del vsix (da `extension.vsixmanifest`),
 * o `undefined` se il file non è leggibile o il manifest non la contiene.
 */
export function readVsixVersion(vsixPath: string): string | undefined {
  const buf = readFileSync(vsixPath);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    // ogni entry zip inizia con un Local File Header (0x04034b50)
    if (buf.readUInt32LE(offset) !== LOCAL_FILE_HEADER) return undefined;
    const method = buf.readUInt16LE(offset + 8); // 0 = stored, 8 = deflate
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;

    if (name === "extension.vsixmanifest") {
      const raw = buf.subarray(dataStart, dataStart + compressedSize);
      let xml: string;
      if (method === 0) xml = raw.toString("utf8");
      else if (method === 8) xml = inflateRawSync(raw).toString("utf8");
      else return undefined;
      return /<Identity[^>]*\bVersion="([^"]+)"/.exec(xml)?.[1];
    }

    offset = dataStart + compressedSize;
  }
  return undefined;
}

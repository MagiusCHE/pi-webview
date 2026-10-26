// crypto.randomUUID() exists only in a SecureContext. A page served over plain
// http:// on a LAN or tailnet address (e.g. the bridge reached by IP) has a
// crypto object without randomUUID: a throw there aborted the Chrome content
// script before it registered any listener, so page context, selection and
// handoff silently stopped working on those pages. getRandomValues also works
// in insecure contexts, so generated ids never depend on https.

export interface RandomSource {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
}

function defaultRandomSource(): RandomSource | undefined {
  return typeof crypto === "undefined" ? undefined : (crypto as RandomSource);
}

export function randomId(
  source: RandomSource | undefined = defaultRandomSource(),
): string {
  if (source && typeof source.randomUUID === "function") {
    try {
      return source.randomUUID();
    } catch {
      // some engines expose randomUUID but reject the call outside https
    }
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

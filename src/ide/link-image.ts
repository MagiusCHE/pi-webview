const IMAGE_MIME = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
]);

export interface LinkImage {
  mimeType: string;
  dataBase64: string;
}

export function linkImageMime(path: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1];
  return extension && IMAGE_MIME.get(extension.toLowerCase());
}

export function webImageUrl(destination: string): string | undefined {
  try {
    const url = new URL(destination);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    if (linkImageMime(url.pathname) || /\.svg$/i.test(url.pathname)) return url.href;
  } catch {
    // Local paths and unsupported URLs are not loaded by the browser.
  }
  return undefined;
}

export function matchesImageHeader(mimeType: string, bytes: Uint8Array): boolean {
  const has = (offset: number, signature: number[]) =>
    signature.every((byte, i) => bytes[offset + i] === byte);
  switch (mimeType) {
    case "image/png":
      return has(0, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return has(0, [255, 216, 255]);
    case "image/gif":
      return (
        has(0, [71, 73, 70, 56]) &&
        (bytes[4] === 55 || bytes[4] === 57) &&
        bytes[5] === 97
      );
    case "image/webp":
      return has(0, [82, 73, 70, 70]) && has(8, [87, 69, 66, 80]);
    case "image/avif":
      return (
        has(4, [102, 116, 121, 112, 97, 118, 105]) &&
        (bytes[11] === 102 || bytes[11] === 115)
      );
    case "image/bmp":
      return has(0, [66, 77]);
    default:
      return false;
  }
}

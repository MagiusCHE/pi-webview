import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLinkImage } from "../src/bridge/link-image.ts";
import { linkImageMime, webImageUrl } from "../src/ide/link-image.ts";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZaUAAAAASUVORK5CYII=",
  "base64",
);

test("preview candidates are known image types, not arbitrary web destinations", () => {
  assert.equal(linkImageMime("media/some image.PNG"), "image/png");
  assert.equal(linkImageMime("C:\\path\\doc.pdf"), undefined);
  assert.equal(
    webImageUrl("https://example.test/a.webp?size=200"),
    "https://example.test/a.webp?size=200",
  );
  assert.equal(webImageUrl("https://example.test/a.svg"), "https://example.test/a.svg");
  assert.equal(webImageUrl("https://user:pass@example.test/a.jpg"), undefined);
  assert.equal(webImageUrl("https://example.test/action?redirect=a.jpg"), undefined);
  assert.equal(webImageUrl("file:///tmp/a.png"), undefined);
});

test("host image preview reads bounded image bytes relative to the current workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piw-link-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "card.png"), image);
  await writeFile(join(root, "not-image.png"), "not an image");
  await writeFile(join(root, "mismatch.jpg"), image);
  await writeFile(join(root, "large.png"), image);
  await truncate(join(root, "large.png"), 9 * 1024 * 1024);
  assert.deepEqual(await readLinkImage("card.png", root), {
    mimeType: "image/png",
    dataBase64: image.toString("base64"),
  });
  for (const path of [
    "not-image.png",
    "mismatch.jpg",
    "large.png",
    "missing.png",
    "//server/path.png",
  ]) {
    assert.equal(await readLinkImage(path, root), null, path);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLocalLinkPath,
  linkTooltip,
  localLinkPath,
  normalizeLinkTooltipMaxChars,
} from "../src/ide/local-link.ts";

test("localLinkPath: resolves typical Markdown destinations to host paths", () => {
  assert.equal(
    localLinkPath("media/temp/carte-confronto-01/01-proposte-facce.png"),
    "media/temp/carte-confronto-01/01-proposte-facce.png",
  );
  assert.equal(
    localLinkPath("media/temp/carte-confronto-01/"),
    "media/temp/carte-confronto-01/",
  );
  assert.equal(localLinkPath("../project/a%20b%23c.png"), "../project/a b#c.png");
  assert.equal(localLinkPath("/tmp/folder/"), "/tmp/folder/");
  assert.equal(localLinkPath("~/my%20files/file.md"), "~/my files/file.md");
  assert.equal(localLinkPath("C:\\A folder\\file.png"), "C:\\A folder\\file.png");
  assert.equal(localLinkPath("file:///C:/A%20folder/file.png"), "C:/A folder/file.png");
  assert.equal(localLinkPath("file:///tmp/image.png#preview"), "/tmp/image.png");
  assert.equal(localLinkPath("file://localhost/tmp/image.png"), "/tmp/image.png");
});

test("localLinkPath: web destinations and unsafe filesystem paths aren't native links", () => {
  for (const href of [
    "https://example.com/file.png",
    "mailto:person@example.com",
    "//example.com/file.png",
    "#heading",
    "?s=session",
    "javascript:run()",
    "command:workbench.action",
    "",
    "file://server/share/x.png",
    "file:////server/share/x.png",
    "\\\\server\\share\\x.png",
    "%2f%2fserver/share/x.png",
    "file:///tmp/%00.png",
    "C:/x.txt:stream",
    "C:x.png",
  ]) {
    assert.equal(localLinkPath(href), undefined, href);
  }
  assert.equal(isLocalLinkPath(null), false);
  assert.equal(isLocalLinkPath("https://example.com"), false);
});

test("link tooltip counts characters, defaults to 50, and doesn't truncate copied destinations", () => {
  for (const bad of [undefined, null, "10", 0, -1, 3.5, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeLinkTooltipMaxChars(bad), 50);
  }
  assert.equal(normalizeLinkTooltipMaxChars(80), 80);
  const url = "https://example.com/a/long/path/that/should/be/truncated/in/the/tooltip";
  assert.equal(linkTooltip(url, 50), url.slice(0, 50));
  assert.equal(linkTooltip(url, 80), url);
  assert.equal(linkTooltip("🌿🌿🌿", 2), "🌿🌿");
});

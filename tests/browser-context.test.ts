import assert from "node:assert/strict";
import test from "node:test";
import { safeBrowserPageUrl } from "../src/adapters/browser/context.ts";

test("browser page context redacts credential-like query values", () => {
  assert.equal(
    safeBrowserPageUrl(
      "https://example.test/page?view=full&token=private&access_token=oauth&code=temporary#section",
    ),
    "https://example.test/page?view=full&token=%5Bredacted%5D&access_token=%5Bredacted%5D&code=%5Bredacted%5D#section",
  );
});

test("browser page context preserves ordinary URL context", () => {
  assert.equal(
    safeBrowserPageUrl("http://example.test/article?q=pi#heading"),
    "http://example.test/article?q=pi#heading",
  );
});

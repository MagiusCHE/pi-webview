import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("src/web/index.html", "utf8");

// VS Code restores the last focused element before execCommand("copy") when
// activeElement is body/html. After typing a prompt, selecting non-focusable
// history leaves body active: Copy then focuses the composer and clears the
// selection. A focusable ancestor lets the browser keep native selection and
// clipboard handling for both keyboard shortcuts and the host's context menu.
test("chat selection has its own focus target for VS Code native Copy", () => {
  const main = /<main\b[^>]*\bid="messages"[^>]*>/.exec(html)?.[0];
  assert.ok(main, "the scrollable chat must exist");
  assert.match(main, /\btabindex="-1"/, "history must receive pointer focus");
  assert.doesNotMatch(main, /\bcontenteditable\b/, "history must remain read-only");
});

test("the chat focus target contains history but not the prompt composer", () => {
  const start = html.indexOf('<main id="messages"');
  const end = html.indexOf("</main>", start);
  const thread = html.indexOf('id="thread"');
  const composer = html.indexOf('id="input"');
  assert.ok(start >= 0 && thread > start && thread < end);
  assert.ok(composer > end, "selecting history must not focus an editable ancestor");
});

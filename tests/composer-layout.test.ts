import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("src/web/index.html", "utf8");
const css = readFileSync("src/web/style.css", "utf8");

// Everything static (composer context row, stats badge, input box, toolbar)
// must live INSIDE <footer>, i.e. below its top border. The area above that
// divider is the scrolling chat: a static row placed there hovers over the last
// messages and looks like part of the conversation (the editor-selection and
// browser-page row used to do exactly that).
test("static composer context row lives below the chat/footer divider", () => {
  const chatEnd = html.indexOf("</main>");
  const footerStart = html.indexOf("<footer>");
  const footerEnd = html.indexOf("</footer>");
  assert.ok(chatEnd >= 0 && footerStart > chatEnd && footerEnd > footerStart);

  // between the scrolling chat and the footer only the steering queue is
  // allowed: it is pending conversation content, not composer context
  const between = html.slice(chatEnd, footerStart);
  assert.deepEqual(
    [...between.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]),
    ["steer-panel"],
  );

  const footer = html.slice(footerStart, footerEnd);
  const order = ["selection-panel", "connect-panel", "stats-badge", 'id="input"'];
  const positions = order.map((id) => footer.indexOf(id));
  const missing = order.filter((_id, index) => (positions[index] ?? -1) < 0);
  assert.deepEqual(missing, [], `missing element in footer: ${missing.join(", ")}`);
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    "the context row must come first, then the badge, then the input box",
  );
});

// The row shares the composer column (badge and input box are `width: 100%`
// capped at the thread width and centered), so the box does not look narrower
// than the input it belongs to.
test("composer context row keeps the composer geometry", () => {
  const rule = /\.selection-panel \{([^}]*)\}/.exec(css);
  assert.ok(rule, ".selection-panel rule missing");
  assert.match(rule[1] ?? "", /width: 100%/);
  assert.match(rule[1] ?? "", /max-width: var\(--thread-max-width\)/);
  assert.doesNotMatch(rule[1] ?? "", /flex:/);
});

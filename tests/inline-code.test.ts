import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/web/style.css", "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing rule: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

// VS Code injects a default `code` rule into every webview, so the IDE already
// paints inline code as a colored chip. The standalone page and the Chrome
// panel have no such stylesheet: without an explicit rule the same markdown
// shows plain monospace text and the two environments look different.
test("inline code uses the VS Code chip geometry", () => {
  const rule = block("\ncode {");
  assert.match(rule, /font-family: var\(--font-mono\)/);
  assert.match(rule, /color: var\(--inline-code-fg\)/);
  assert.match(rule, /background-color: var\(--inline-code-bg\)/);
  assert.match(rule, /padding: 1px 3px/);
  assert.match(rule, /border-radius: 4px/);
});

// The tokens must keep reading the theme variables: in the IDE the chip color
// stays the user's own textPreformat color, the fallback is standalone-only.
test("inline code colors come from the theme with a standalone fallback", () => {
  const fg = css.match(/--inline-code-fg: ([^;]+);/g) ?? [];
  const bg = css.match(/--inline-code-bg: ([^;]+);/g) ?? [];
  assert.equal(fg.length, 2, "one token per theme (dark + light)");
  assert.equal(bg.length, 2, "one token per theme (dark + light)");
  const [darkFg, lightFg] = fg;
  const [darkBg, lightBg] = bg;
  assert.ok(darkFg && lightFg && darkBg && lightBg);
  for (const token of [darkFg, lightFg, darkBg, lightBg]) {
    assert.match(token, /var\(--vscode-textPreformat-(foreground|background), /);
  }
  assert.match(darkFg, /#cc7d5e/, "dark fallback stays in the terracotta accent");
  assert.match(darkBg, /rgb\(255 255 255 \/ 0\.07\)/);
  assert.match(lightFg, /#a8552f/, "light fallback is a darker terracotta (AA)");
  assert.match(lightBg, /rgb\(0 0 0 \/ 0\.05\)/);
});

// A fence is already a surface: the inline chip must not show through it, and
// the block keeps its own foreground instead of the theme preformat color.
test("code blocks keep their surface instead of the inline chip", () => {
  const rule = block("\npre code {");
  assert.match(rule, /padding: 0/);
  assert.match(rule, /background-color: transparent/);
  assert.match(rule, /color: inherit/);
  assert.match(block("\n.code-block pre {"), /color: var\(--fg-secondary\)/);
});

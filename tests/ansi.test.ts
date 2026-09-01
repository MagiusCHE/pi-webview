import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAnsiToHtml, stripAnsi } from "../src/web/ansi.ts";

test("ANSI: escapes HTML and maps the adaptive base palette", () => {
  const rendered = renderAnsiToHtml("plain <tag> \u001b[31mred & safe\u001b[39m end");
  assert.equal(
    rendered,
    'plain &lt;tag&gt; <span class="ansi-fg-1">red &amp; safe</span> end',
  );
});

test("ANSI: preserves the actual 256-color RGB value", () => {
  assert.equal(
    renderAnsiToHtml("\u001b[38;5;109mteal\u001b[39m"),
    '<span class="ansi-fg-109">teal</span>',
  );
  assert.equal(
    renderAnsiToHtml("\u001b[38;5;244mgray\u001b[0m"),
    '<span class="ansi-fg-244">gray</span>',
  );
});

test("ANSI: renders truecolor without treating RGB channels as SGR commands", () => {
  assert.equal(
    renderAnsiToHtml("\u001b[38;2;30;90;37mcolor\u001b[39m"),
    '<span class="ansi-fg-22">color</span>',
  );
});

test("ANSI: combines bold with color and handles independent resets", () => {
  assert.equal(
    renderAnsiToHtml("\u001b[1;92mbold green\u001b[22m green\u001b[0m plain"),
    '<span class="ansi-fg-10 ansi-bold">bold green</span>' +
      '<span class="ansi-fg-10"> green</span> plain',
  );
});

test("ANSI: renders the pi-spark credits status with distinct palette classes", () => {
  assert.equal(
    renderAnsiToHtml("\u001b[38;5;241mCodex \u001b[39m\u001b[38;5;143m7d 8%\u001b[39m"),
    '<span class="ansi-fg-241">Codex </span><span class="ansi-fg-143">7d 8%</span>',
  );
});

test("ANSI: strips CSI and OSC sequences from plain-text tooltips", () => {
  assert.equal(
    stripAnsi("\u001b]0;title\u0007\u001b[38;5;109mstatus\u001b[39m"),
    "status",
  );
});

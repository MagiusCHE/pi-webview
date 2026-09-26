import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thinkingPaintDecision } from "../src/web/thinking-render.ts";

test("a collapsed thought is never formatted", () => {
  assert.equal(thinkingPaintDecision(true, "**bold** text", undefined), "collapsed");
  // even when the text changed while the block was closed
  assert.equal(thinkingPaintDecision(true, "**bold** text", "old text"), "collapsed");
});

test("an open thought is painted when its text changed", () => {
  assert.equal(thinkingPaintDecision(false, "**bold**", undefined), "paint");
  assert.equal(thinkingPaintDecision(false, "**bold** more", "**bold**"), "paint");
});

test("an unchanged open thought is not re-parsed", () => {
  assert.equal(thinkingPaintDecision(false, "**bold**", "**bold**"), "current");
});

test("thinking bodies are rendered as markdown, not as plain text", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  // every thought body goes through the shared markdown renderer
  assert.match(web, /function renderThinkingBody\(body: HTMLElement\)/);
  assert.match(web, /body\.innerHTML = renderMarkdown\(text\)/);
  assert.match(web, /enhanceCodeBlocks\(body\)/);
  // the old plain-text node streaming path is gone
  assert.doesNotMatch(web, /thinkingTextNode/);
  // expanding a block is what triggers its first render
  assert.match(web, /if \(expanded\) renderThinkingBody\(body\)/);
  // consecutive provider thought blocks stay one card: the accumulation is
  // index-agnostic, so nothing splits them
  assert.match(web, /thinkingAccum \+= action\.delta/);
  const css = readFileSync("src/web/style.css", "utf8");
  const content = /\.thinking-content \{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  assert.doesNotMatch(content, /white-space: pre-wrap/);
});

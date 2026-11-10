import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findChatSearchMatches, nextChatSearchIndex } from "../src/web/chat-search.ts";
import { searchIcon } from "../src/web/icons.ts";
import { LOCALES } from "../src/web/i18n.ts";

test("chat search finds literal text regardless of case", () => {
  assert.deepEqual(findChatSearchMatches("Chat CHAT chat", "chat"), [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
    { start: 10, end: 14 },
  ]);
});

test("chat search treats regex metacharacters and HTML as ordinary text", () => {
  const query = "[a-z]+ (x)? $5. \\ <script>";
  assert.deepEqual(findChatSearchMatches(`before ${query} after`, query), [
    { start: 7, end: 7 + query.length },
  ]);
  assert.deepEqual(findChatSearchMatches("anything", ".*"), []);
});

test("chat search ignores empty queries and trims accidental surrounding spaces", () => {
  for (const query of ["", " ", "\n\t"]) {
    assert.deepEqual(findChatSearchMatches("anything", query), []);
  }
  assert.deepEqual(findChatSearchMatches("a phrase here", " phrase "), [
    { start: 2, end: 8 },
  ]);
});

test("chat search matches phrases over newlines and repeated whitespace", () => {
  assert.deepEqual(findChatSearchMatches("a word\n  and\tphrase!", "word and phrase"), [
    { start: 2, end: 19 },
  ]);
});

test("chat search preserves DOM UTF-16 offsets for emoji and accented text", () => {
  assert.deepEqual(findChatSearchMatches("🙂 CITTÀ città", "città"), [
    { start: 3, end: 8 },
    { start: 9, end: 14 },
  ]);
  // Lowercasing the entire text would expand İ and shift all later offsets.
  assert.deepEqual(findChatSearchMatches("İ CHAT", "chat"), [{ start: 2, end: 6 }]);
});

test("chat search uses non-overlapping matches, like native find", () => {
  assert.deepEqual(findChatSearchMatches("aaaaa", "aa"), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});

test("chat search navigation wraps and handles empty or single results", () => {
  assert.equal(nextChatSearchIndex(-1, 0, 1), -1);
  assert.equal(nextChatSearchIndex(-1, 0, -1), -1);
  assert.equal(nextChatSearchIndex(-1, 3, 1), 0);
  assert.equal(nextChatSearchIndex(-1, 3, -1), 2);
  assert.equal(nextChatSearchIndex(2, 3, 1), 0);
  assert.equal(nextChatSearchIndex(0, 3, -1), 2);
  assert.equal(nextChatSearchIndex(0, 1, 1), 0);
  assert.equal(nextChatSearchIndex(0, 1, -1), 0);
});

test("chat search controls are outside the transcript and composer", () => {
  const html = readFileSync("src/web/index.html", "utf8");
  const bar = html.indexOf('id="chat-search"');
  const messages = html.indexOf('<main id="messages"');
  assert.ok(bar > 0 && bar < messages);
  assert.match(html, /id="btn-chat-search"[\s\S]*?aria-controls="chat-search"/);
  assert.match(html, /id="chat-search-count"[^>]*role="status"/);
  assert.match(html, /id="chat-search-input"[\s\S]*?aria-describedby="chat-search-hint"/);
});

test("chat search has localized labels in both languages and an accessible icon", () => {
  for (const key of [
    "chatSearch",
    "chatSearchPlaceholder",
    "chatSearchScope",
    "chatSearchPrevious",
    "chatSearchNext",
    "chatSearchClose",
    "chatSearchNoResults",
    "chatSearchCount",
  ]) {
    assert.ok(LOCALES.it.ui[key]);
    assert.ok(LOCALES.en.ui[key]);
  }
  assert.match(searchIcon(), /^<svg/);
  assert.match(searchIcon(), /currentColor/);
  assert.match(searchIcon(), /aria-hidden="true"/);
});

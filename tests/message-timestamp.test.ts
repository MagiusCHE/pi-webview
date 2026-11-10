import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("src/web/main.ts", "utf8");
const css = readFileSync("src/web/style.css", "utf8");

test("every transcript message carries a localized timestamp element", () => {
  // shared web UI: standalone bridge, IDE companions and the Chrome panel
  assert.match(
    main,
    /function attachMessageTimestamp\(wrapper: HTMLElement, timestamp: number\)/,
  );
  assert.match(main, /element\.className = "msg-time"/);
  assert.match(main, /element\.dateTime = label\.iso/);
  assert.match(main, /element\.title = label\.full/);
  // the label is relative to today and localized through the shared module
  assert.match(main, /messageTimeLabel\(stamp, \{/);
  assert.match(main, /yesterday: t\("yesterday"\)/);
  // attached for user and assistant messages, never for status lines
  assert.match(
    main,
    /if \(kind !== "status"\) attachMessageTimestamp\(wrapper, timestamp\);/,
  );
});

test("history and live messages pass their own timestamp", () => {
  // history: entries carry an ISO timestamp
  assert.match(main, /renderUserContent\(msg\.content, ts\);/);
  assert.match(main, /const wrapper = addMsg\("assistant", null, assistantTs\);/);
  // live: message_start provides the assistant timestamp
  assert.match(main, /pendingAssistantTimestamp = parseTs\(evt\.message\)/);
  // injected cross-session cards keep their entry timestamp
  assert.match(main, /const wrapper = addMsg\("user", null, ts\);/);
});

test("the timestamp stays discreet and reveals itself on hover", () => {
  assert.match(css, /\.msg-time \{/);
  assert.match(css, /opacity: 0;/);
  assert.match(css, /\.msg:hover \.msg-time,/);
  assert.match(css, /\.msg:focus-within \.msg-time \{/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

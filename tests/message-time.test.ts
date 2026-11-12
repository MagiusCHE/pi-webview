import { test } from "node:test";
import assert from "node:assert/strict";
import { messageTimeLabel } from "../src/web/message-time.ts";

// a fixed reference instant: 2026-11-10 21:30 local time
const now = new Date(2026, 10, 10, 21, 30, 0).getTime();
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute, 0).getTime();
const label = (timestamp: number, locale = "it-IT", hour12 = false, sep = " alle ") =>
  messageTimeLabel(timestamp, {
    locale,
    yesterday: "ieri",
    dateSeparator: sep,
    hour12,
    now,
  });

test("same day shows only the localized time", () => {
  const result = label(at(2026, 11, 10, 9, 5));
  assert.match(result.short, /^0?9[:.]05$/);
  assert.match(result.full, /2026/);
  assert.equal(result.iso, new Date(at(2026, 11, 10, 9, 5)).toISOString());
});

test("the previous day is marked as yesterday", () => {
  const result = label(at(2026, 11, 9, 23, 59));
  assert.match(result.short, /^ieri /);
  assert.match(result.short, /2[13][:.]59$/);
});

test("older messages carry the date, and the year when it differs", () => {
  const older = label(at(2026, 11, 2, 18, 42));
  assert.match(older.short, /02/);
  assert.equal(older.short, "02 nov alle 18:42");
  assert.doesNotMatch(older.short, /2026/);

  const lastYear = label(at(2025, 12, 31, 23, 10));
  assert.match(lastYear.short, /2025/);
  assert.equal(lastYear.short, "31 dic 2025 alle 23:10");
});

test("the date and the clock are always separated, in the active language", () => {
  // Italian says "08 nov alle 16:57", English keeps the conventional comma
  assert.equal(
    label(at(2026, 11, 8, 16, 57), "it-IT", false, " alle ").short,
    "08 nov alle 16:57",
  );
  assert.equal(
    label(at(2026, 11, 8, 16, 57), "en-US", false, ", ").short,
    "Nov 08, 16:57",
  );
  // a date and a clock glued with a bare space is a bug, never a fallback
  for (const sep of [" alle ", ", "]) {
    for (const locale of ["it-IT", "en-US"]) {
      const short = label(at(2026, 11, 8, 16, 57), locale, false, sep).short;
      assert.ok(short.includes(sep), `${locale}/${sep}: ${short}`);
      assert.doesNotMatch(short, /\d \d{2}:\d{2}/);
    }
  }
});

test("the tooltip always carries date, time and seconds", () => {
  for (const timestamp of [
    at(2026, 11, 10, 8, 0),
    at(2026, 10, 1, 8, 0),
    at(2025, 1, 5, 8, 0),
  ]) {
    const { full } = label(timestamp);
    assert.match(full, /\d{1,2}:\d{2}:\d{2}/);
    assert.match(full, /\d{4}/);
  }
});

test("a future timestamp never renders a negative day count", () => {
  const result = label(at(2026, 11, 10, 23, 0));
  assert.match(result.short, /^2[23][:.]00$/);
});

test("the clock is 24-hour by default", () => {
  // it-IT is already 24h, but the default must not depend on the locale
  assert.equal(label(at(2026, 11, 10, 14, 30), "en-US").short, "14:30");
  assert.equal(label(at(2026, 11, 10, 21, 42), "en-US").short, "21:42");
});

test("an explicit 12-hour preference wins over the locale default", () => {
  assert.equal(label(at(2026, 11, 10, 14, 30), "it-IT", true).short, "02:30 PM");
  assert.match(label(at(2026, 11, 10, 9, 5), "it-IT", true).short, /^09:05 AM$/);
});

test("the tooltip follows the same clock format as the short label", () => {
  assert.match(label(at(2026, 11, 10, 14, 30), "en-US").full, /14:30:00/);
  assert.match(label(at(2026, 11, 10, 14, 30), "en-US", true).full, /02:30:00\s?PM/);
});

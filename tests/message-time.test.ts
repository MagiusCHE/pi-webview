import { test } from "node:test";
import assert from "node:assert/strict";
import { messageTimeLabel } from "../src/web/message-time.ts";

// a fixed reference instant: 2026-11-10 21:30 local time
const now = new Date(2026, 10, 10, 21, 30, 0).getTime();
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute, 0).getTime();
const label = (timestamp: number, locale = "it-IT") =>
  messageTimeLabel(timestamp, { locale, yesterday: "ieri", now });

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
  assert.match(older.short, /18[:.]42$/);
  assert.doesNotMatch(older.short, /2026/);

  const lastYear = label(at(2025, 12, 31, 23, 10));
  assert.match(lastYear.short, /2025/);
  assert.match(lastYear.short, /23[:.]10$/);
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

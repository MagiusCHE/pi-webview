import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHROME_WEB_STORE_URL,
  extractReleaseNotes,
  formatChangelogReminder,
  formatWaysReminder,
  ReleaseReminderStore,
  shouldShowReleaseReminder,
} from "../packages/pi-webview/lib/release-reminder.ts";
import { releaseChangelog } from "../tools/changelog.mjs";

const bilingualChangelog = `# Changelog

## [Unreleased]

### Italiano

- Novità italiana.

### English

- English change.

## [0.3.2] - 2026-09-14

### Italiano

- Correzione italiana.

### English

- English fix.
`;

test("the reminder lists every mode and the permanent Chrome Web Store URL", () => {
  const italian = formatWaysReminder("0.4.0", "it");
  assert.match(italian, /Browser View/);
  assert.match(italian, /piw-public 7361 --tailscale/);
  assert.match(italian, /Visual Studio Code/);
  assert.match(italian, /Visual Studio 2022\/2026/);
  assert.match(italian, /Google Chrome Side Panel/);
  assert.match(italian, new RegExp(CHROME_WEB_STORE_URL));
  assert.doesNotMatch(italian, /\/piw install/);

  const english = formatWaysReminder("0.4.0", "en");
  assert.match(english, /was installed or updated/);
  assert.match(english, new RegExp(CHROME_WEB_STORE_URL));
});

test("localized release notes become a separate changelog box", () => {
  const italian = extractReleaseNotes(bilingualChangelog, "0.3.2", "it");
  const english = extractReleaseNotes(bilingualChangelog, "0.3.2", "en");
  assert.deepEqual(italian, ["Correzione italiana."]);
  assert.deepEqual(english, ["English fix."]);
  assert.equal(
    formatChangelogReminder("0.3.2", italian, "it"),
    "Novità in pi-webview 0.3.2:\n• Correzione italiana.",
  );
  assert.equal(formatChangelogReminder("9.9.9", [], "en"), null);
});

test("a reminder is shown only on first install or a newer version", () => {
  assert.equal(shouldShowReleaseReminder("0.4.0", undefined), true);
  assert.equal(shouldShowReleaseReminder("0.4.0", "0.3.2"), true);
  assert.equal(shouldShowReleaseReminder("0.4.0", "0.4.0"), false);
  assert.equal(shouldShowReleaseReminder("0.3.2", "0.4.0"), false);
});

test("release reminder state persists outside session files", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-reminder-"));
  try {
    const store = new ReleaseReminderStore(dir);
    assert.equal(store.shouldShow("0.4.0"), true);
    store.markShown("0.4.0");
    assert.equal(store.shouldShow("0.4.0"), false);
    assert.equal(store.shouldShow("0.4.1"), true);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "release-reminder.json"), "utf8"))
        .lastShownVersion,
      "0.4.0",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release preparation moves bilingual Unreleased notes once", () => {
  const released = releaseChangelog(bilingualChangelog, "0.4.0", "2026-09-15");
  assert.match(released, /## \[Unreleased\]\s+## \[0\.4\.0\] - 2026-09-15/);
  assert.deepEqual(extractReleaseNotes(released, "0.4.0", "it"), ["Novità italiana."]);
  assert.equal(releaseChangelog(released, "0.4.0", "2026-09-16"), released);
});

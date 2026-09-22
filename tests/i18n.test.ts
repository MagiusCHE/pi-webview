import { test } from "node:test";
import assert from "node:assert/strict";
import { t, setLocale, currentLocale, isLocaleId, LOCALES } from "../src/web/i18n.ts";

test("locale: tutte le chiavi it hanno un corrispettivo en", () => {
  for (const key of Object.keys(LOCALES.it.ui)) {
    assert.ok(key in LOCALES.en.ui, `chiave mancante in en: ${key}`);
    assert.ok(LOCALES.en.ui[key], `valore vuoto in en: ${key}`);
  }
});

test("locale: t() rispetta la lingua corrente e ricade su it", () => {
  setLocale("it");
  assert.equal(t("connected"), "connesso");
  assert.equal(t("thinking"), "Sta pensando…");

  setLocale("en");
  assert.equal(t("connected"), "connected");
  assert.equal(t("thinking"), "Thinking…");

  // chiave sconosciuta → la chiave stessa
  assert.equal(t("chiave_inesistente"), "chiave_inesistente");
});

test("locale: isLocaleId e currentLocale", () => {
  assert.equal(isLocaleId("it"), true);
  assert.equal(isLocaleId("en"), true);
  assert.equal(isLocaleId("fr"), false);
  assert.equal(isLocaleId(null), false);
  assert.ok(currentLocale === "it" || currentLocale === "en");
});

// A multi-word label left identical in both languages is a missing
// translation, not a style choice ("Agentic thinking" shipped untranslated in
// the Italian UI). Only language-neutral values are allowed to match.
const LANGUAGE_NEUTRAL_LABELS = new Set([
  "autoCompactAt", // technical wording
  "demoToolCommand", // shell command
  "updateVersionRange", // version placeholder
]);

test("locale: nessuna etichetta multi-parola resta in inglese nella UI italiana", () => {
  const untranslated = Object.keys(LOCALES.it.ui).filter((key) => {
    const value = LOCALES.it.ui[key];
    const english = LOCALES.en.ui[key];
    return (
      typeof value === "string" &&
      typeof english === "string" &&
      value === english &&
      value.length >= 12 &&
      /\s/.test(value) &&
      !LANGUAGE_NEUTRAL_LABELS.has(key)
    );
  });
  assert.deepEqual(
    untranslated,
    [],
    `etichette non tradotte in it.json: ${untranslated.join(", ")}`,
  );
});

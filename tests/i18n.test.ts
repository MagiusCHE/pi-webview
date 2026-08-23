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

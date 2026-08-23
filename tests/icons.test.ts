import { test } from "node:test";
import assert from "node:assert/strict";
import { trustIcon, sendIcon, stopIcon } from "../src/web/icons.ts";

test("trustIcon: shield colorabile via currentColor", () => {
  const s = trustIcon("shield");
  assert.match(s, /^<svg/);
  assert.match(s, /fill="currentColor"/);
  assert.match(s, /shield|M12 2L4 5/);
});

test("trustIcon: warn outline senza fill, con stroke", () => {
  const s = trustIcon("warn-outline");
  assert.match(s, /fill="none"/);
  assert.match(s, /stroke="currentColor"/);
});

test("trustIcon: warn filled con fill currentColor e stesso path", () => {
  const filled = trustIcon("warn-filled");
  const outline = trustIcon("warn-outline");
  assert.match(filled, /fill="currentColor"/);
  // stesso triangolo: il path interno coincide
  const path = /<path d="([^"]+)"\/>/;
  assert.equal(filled.match(path)?.[1], outline.match(path)?.[1]);
});

test("sendIcon/stopIcon: icone SVG colorabili, glifi diversi", () => {
  const send = sendIcon();
  const stop = stopIcon();
  assert.match(send, /^<svg/);
  assert.match(send, /fill="currentColor"/);
  assert.match(stop, /^<svg/);
  assert.match(stop, /M6 6h12v12H6/);
  // non sono la stessa icona
  assert.notEqual(send, stop);
});

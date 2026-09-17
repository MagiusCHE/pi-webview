import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrowUpIcon,
  openFileIcon,
  trustIcon,
  sendIcon,
  microphoneIcon,
  speechWaveformIcon,
  stopIcon,
} from "../src/web/icons.ts";

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
  // same triangle: the inner path matches
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
  // they are not the same icon
  assert.notEqual(send, stop);
});

test("microphone and active waveform distinguish dictation state without color alone", () => {
  const microphone = microphoneIcon();
  const waveform = speechWaveformIcon();
  assert.match(microphone, /^<svg/);
  assert.match(microphone, /fill="currentColor"/);
  assert.match(waveform, /^<svg/);
  assert.match(waveform, /speech-waveform/);
  assert.match(waveform, /speech-wave-bar-1/);
  assert.notEqual(microphone, waveform);
});

test("openFileIcon: external-link SVG colorabile", () => {
  const icon = openFileIcon();
  assert.match(icon, /^<svg/);
  assert.match(icon, /fill="currentColor"/);
  assert.match(icon, /M19 19H5V5h7V3/);
});

test("arrowUpIcon: repeated collapse footer uses an upward arrow", () => {
  const icon = arrowUpIcon();
  assert.match(icon, /^<svg/);
  assert.match(icon, /stroke="currentColor"/);
  assert.match(icon, /M12 9v12/);
});

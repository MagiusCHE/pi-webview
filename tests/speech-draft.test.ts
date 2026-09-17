import assert from "node:assert/strict";
import test from "node:test";
import { SpeechDraft } from "../src/web/speech-draft.ts";

test("SpeechDraft replaces only the selected manual range while dictating", () => {
  const draft = new SpeechDraft();
  draft.begin({
    value: "Keep this, replace that.",
    selectionStart: 11,
    selectionEnd: 24,
  });

  assert.deepEqual(draft.update("with this"), {
    value: "Keep this, with this",
    selectionStart: 20,
    selectionEnd: 20,
  });
  assert.deepEqual(draft.commit(), {
    value: "Keep this, with this",
    selectionStart: 20,
    selectionEnd: 20,
  });
  assert.equal(draft.active, false);
});

test("SpeechDraft restores a pre-existing manual draft after a voice submit", () => {
  const draft = new SpeechDraft();
  draft.begin({ value: "Manual text", selectionStart: 6, selectionEnd: 6 });
  draft.update("spoken segment");

  assert.deepEqual(draft.restore(), {
    value: "Manual text",
    selectionStart: 6,
    selectionEnd: 6,
  });
  assert.equal(draft.active, false);
});

test("SpeechDraft keeps interim replacement separate from final text", () => {
  const draft = new SpeechDraft();
  draft.begin({ value: "", selectionStart: 0, selectionEnd: 0 });

  assert.equal(draft.update("first interim")?.value, "first interim");
  assert.equal(draft.update("final words")?.value, "final words");
  assert.deepEqual(draft.cancel(), { value: "", selectionStart: 0, selectionEnd: 0 });
});

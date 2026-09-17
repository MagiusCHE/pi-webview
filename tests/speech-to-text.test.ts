import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SPEECH_TO_TEXT_CONFIG,
  normalizeSpeechToTextConfig,
} from "../src/ide/speech-config.ts";
import {
  detectSpeechCapabilities,
  formatSpeechShortcut,
  getSpeechMicrophonePermission,
  localSpeechModelControlState,
  parseSpeechShortcut,
  speechShortcutFromKeyboardEvent,
  speechShortcutMatchesEvent,
  transcriptFromRecognitionEvent,
  type SpeechRecognitionResultEventLike,
} from "../src/web/speech-to-text.ts";

test("speech config defaults to local push-to-talk without a device id", () => {
  assert.deepEqual(DEFAULT_SPEECH_TO_TEXT_CONFIG, {
    mode: "push-to-talk",
    language: "system",
    allowCloudTranscription: false,
    toggleSilenceMs: 1500,
    shortcuts: {
      pushToTalk: "Ctrl+Alt+Space",
      toggleToTalk: "Ctrl+Alt+M",
    },
    inputByRuntime: {},
  });
});

test("speech config discards malformed values and device ids", () => {
  assert.deepEqual(
    normalizeSpeechToTextConfig({
      mode: "always-on",
      language: "",
      allowCloudTranscription: "yes",
      toggleSilenceMs: 99_999,
      shortcuts: { pushToTalk: "Ctrl+Alt", toggleToTalk: 3 },
      inputByRuntime: { vscode: " ", standalone: "device-1", bad: 12 },
    }),
    {
      ...DEFAULT_SPEECH_TO_TEXT_CONFIG,
      toggleSilenceMs: 10_000,
      inputByRuntime: { standalone: "device-1" },
    },
  );
});

test("speech capability detection honors an embedding microphone policy", () => {
  const capabilities = detectSpeechCapabilities({
    document: {
      permissionsPolicy: {
        allowsFeature: (feature) => feature !== "microphone",
      },
    },
  });
  assert.equal(capabilities.microphonePolicyAllowsCapture, false);
});

test("microphone permission probe reads an existing browser grant without media access", async () => {
  let requestedName = "";
  const permission = await getSpeechMicrophonePermission({
    navigator: {
      permissions: {
        query: async ({ name }) => {
          requestedName = name;
          return { state: "granted" };
        },
      },
    },
  });
  assert.equal(permission, "granted");
  assert.equal(requestedName, "microphone");
});

test("local model controls explain unavailable embedded-Webview capabilities", () => {
  const base = {
    recognition: true,
    localRecognition: true,
    cloudRecognition: true,
    modelAvailability: true,
    modelInstall: true,
    modelRemoval: false as const,
    inputEnumeration: true,
    inputSelection: true,
    microphonePolicyAllowsCapture: true,
    microphonePermission: "unknown" as const,
  };
  assert.equal(
    localSpeechModelControlState({ ...base, localRecognition: false }, "unknown"),
    "local-recognition-unavailable",
  );
  assert.equal(
    localSpeechModelControlState({ ...base, modelAvailability: false }, "unknown"),
    "availability-unavailable",
  );
  assert.equal(
    localSpeechModelControlState({ ...base, modelInstall: false }, "downloadable"),
    "install-unavailable",
  );
  assert.equal(localSpeechModelControlState(base, "downloadable"), "downloadable");
});

test("speech shortcut normalization requires a modifier and a non-modifier key", () => {
  assert.deepEqual(parseSpeechShortcut("Alt+Ctrl+Space"), {
    modifiers: new Set(["Ctrl", "Alt"]),
    code: "Space",
  });
  assert.equal(parseSpeechShortcut("Ctrl+Alt"), null);
  assert.equal(parseSpeechShortcut("Space"), null);
  assert.equal(formatSpeechShortcut("Alt+Ctrl+Space"), "Ctrl+Alt+Space");
});

test("speech shortcut event matching retains the physical key code", () => {
  const event = {
    code: "Space",
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  } as KeyboardEvent;
  assert.equal(speechShortcutMatchesEvent("Ctrl+Alt+Space", event), true);
  assert.equal(speechShortcutFromKeyboardEvent(event), "Ctrl+Alt+Space");
  assert.equal(
    speechShortcutMatchesEvent("Ctrl+Alt+M", { ...event, code: "KeyM" } as KeyboardEvent),
    false,
  );
});

test("recognition transcripts preserve final and interim segments separately", () => {
  const event: SpeechRecognitionResultEventLike = {
    results: [
      { isFinal: true, 0: { transcript: "first final" } },
      { isFinal: true, 0: { transcript: "second final" } },
      { isFinal: false, 0: { transcript: "still speaking" } },
    ],
  };
  assert.deepEqual(transcriptFromRecognitionEvent(event), {
    finalText: "first final second final",
    interimText: "still speaking",
  });
});

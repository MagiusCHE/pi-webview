// Shared, persistent preferences for microphone speech-to-text.
// This module intentionally contains no browser APIs so every host can read and
// normalize the same config file.

export type SpeechInputMode = "push-to-talk" | "toggle-to-talk";

export interface SpeechToTextShortcuts {
  pushToTalk: string;
  toggleToTalk: string;
}

export interface SpeechToTextConfig {
  mode: SpeechInputMode;
  /** "system" follows the browser/host language; explicit values are BCP-47 tags. */
  language: "system" | string;
  /** Explicit privacy opt-in. False means local recognition only. */
  allowCloudTranscription: boolean;
  /** Silence required before automatic send in toggle-to-talk mode. */
  toggleSilenceMs: number;
  /** Keyboard shortcuts are scoped to the focused Web UI. */
  shortcuts: SpeechToTextShortcuts;
  /** Opaque device IDs are scoped to the browser/WebView that issued them. */
  inputByRuntime: Record<string, "default" | string>;
}

export const DEFAULT_SPEECH_TO_TEXT_SHORTCUTS: SpeechToTextShortcuts = {
  pushToTalk: "Ctrl+Alt+Space",
  toggleToTalk: "Ctrl+Alt+M",
};

export const DEFAULT_SPEECH_TO_TEXT_CONFIG: SpeechToTextConfig = {
  mode: "push-to-talk",
  language: "system",
  allowCloudTranscription: false,
  toggleSilenceMs: 1_500,
  shortcuts: { ...DEFAULT_SPEECH_TO_TEXT_SHORTCUTS },
  inputByRuntime: {},
};

const MIN_TOGGLE_SILENCE_MS = 500;
const MAX_TOGGLE_SILENCE_MS = 10_000;
const MAX_DEVICE_ID_LENGTH = 1_024;
const MAX_RUNTIME_KEY_LENGTH = 256;

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const SHORTCUT_MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

/**
 * Accept only the portable KeyboardEvent.code format captured by the Web UI.
 * This keeps malformed persisted config from turning a global shortcut into an
 * unpredictable key handler.
 */
function validShortcut(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || value.length > 100) return fallback;
  const modifiers = new Set<string>();
  let code = "";
  for (const part of parts) {
    const modifier = SHORTCUT_MODIFIER_ORDER.find(
      (candidate) => candidate.toLowerCase() === part.toLowerCase(),
    );
    if (modifier) {
      if (modifiers.has(modifier)) return fallback;
      modifiers.add(modifier);
    } else if (!code) {
      code = part;
    } else {
      return fallback;
    }
  }
  if (!code || modifiers.size === 0) return fallback;
  return [
    ...SHORTCUT_MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    code,
  ].join("+");
}

function normalizeInputByRuntime(value: unknown): Record<string, "default" | string> {
  const source = plainObject(value);
  if (!source) return {};
  const result: Record<string, "default" | string> = {};
  for (const [key, device] of Object.entries(source)) {
    if (!key || key.length > MAX_RUNTIME_KEY_LENGTH) continue;
    if (device === "default") {
      result[key] = "default";
    } else if (
      typeof device === "string" &&
      device.trim().length > 0 &&
      device.length <= MAX_DEVICE_ID_LENGTH
    ) {
      result[key] = device;
    }
  }
  return result;
}

/**
 * Migrates absent or partial persisted values without accepting malformed
 * device IDs, modes or unbounded silence delays from a config file.
 */
export function normalizeSpeechToTextConfig(value: unknown): SpeechToTextConfig {
  const source = plainObject(value);
  const shortcuts = plainObject(source?.shortcuts);
  const mode = source?.mode === "toggle-to-talk" ? "toggle-to-talk" : "push-to-talk";
  const language =
    typeof source?.language === "string" && source.language.trim().length > 0
      ? source.language.trim()
      : "system";
  const requestedSilence =
    typeof source?.toggleSilenceMs === "number" && Number.isFinite(source.toggleSilenceMs)
      ? Math.round(source.toggleSilenceMs)
      : DEFAULT_SPEECH_TO_TEXT_CONFIG.toggleSilenceMs;

  return {
    mode,
    language,
    allowCloudTranscription: source?.allowCloudTranscription === true,
    toggleSilenceMs: Math.max(
      MIN_TOGGLE_SILENCE_MS,
      Math.min(MAX_TOGGLE_SILENCE_MS, requestedSilence),
    ),
    shortcuts: {
      pushToTalk: validShortcut(
        shortcuts?.pushToTalk,
        DEFAULT_SPEECH_TO_TEXT_SHORTCUTS.pushToTalk,
      ),
      toggleToTalk: validShortcut(
        shortcuts?.toggleToTalk,
        DEFAULT_SPEECH_TO_TEXT_SHORTCUTS.toggleToTalk,
      ),
    },
    inputByRuntime: normalizeInputByRuntime(source?.inputByRuntime),
  };
}
